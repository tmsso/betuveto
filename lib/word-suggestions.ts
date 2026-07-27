/**
 * Word curation: suggesting a missing word (ROADMAP Batch 4.2), 4.1's natural twin.
 *
 * Whether the word is entirely new or already sitting in `words` (active or still
 * pending an earlier suggestion) is not something the caller needs to distinguish from
 * an error — both are a normal "thanks, noted" outcome, same as 4.1's report endpoint
 * treating a repeat report as a no-op rather than a 409. Only bad input, missing
 * identity, and the rate limit are real errors.
 */
import { db, wordlistId } from "./db.js";
import type { Reply } from "./game.js";
import { letterCount, normalizeWord, signatureOf } from "./words.js";

// Q, W, X, Y excluded on purpose: they appear only in foreign loanwords/proper nouns, not
// the standard 40-letter Hungarian alphabet this curation feature is meant to protect.
const HUNGARIAN_ALPHABET = /^[ABCDEFGHIJKLMNOPRSTUVZÁÉÍÓÖŐÚÜŰ]+$/;

const MAX_SUGGESTIONS_PER_DAY = 10;

export async function suggestWord(
  playerId: string | null,
  rawWord: unknown,
  wordlistCode: string,
): Promise<Reply> {
  if (!playerId) {
    return { status: 401, body: { detail: "No player identity. Start a game first." } };
  }
  if (typeof rawWord !== "string") {
    return { status: 422, body: { detail: "word must be a string." } };
  }
  const word = normalizeWord(rawWord);
  if (!word || !HUNGARIAN_ALPHABET.test(word)) {
    return {
      status: 422,
      body: { detail: "word must be 3-15 letters of the Hungarian alphabet." },
    };
  }

  const sql = db();
  const listId = await wordlistId(wordlistCode);

  const [existing] = await sql<{ id: number }[]>`
    select id from words where wordlist_id = ${listId} and word = ${word}
  `;
  if (existing) {
    return { status: 200, body: { suggested: true, already_present: true } };
  }

  // The word lands in `words` right away (inactive), not just in word_suggestions: this
  // reuses the signature/length machinery as-is and gives Batch 5's review queue a real
  // row to activate rather than a separate approval pipeline.
  const [wordRow] = await sql<{ id: number }[]>`
    insert into words (wordlist_id, word, length, signature, active, source)
    values (${listId}, ${word}, ${letterCount(word)}, ${signatureOf(word)}, false, 'suggested')
    on conflict (wordlist_id, word) do nothing
    returning id
  `;
  // A concurrent request could have inserted the same word between the check above and
  // here; on conflict do nothing leaves wordRow undefined, which just means "someone else
  // already suggested this in the last instant" — same non-error outcome as the check above.
  if (!wordRow) {
    return { status: 200, body: { suggested: true, already_present: true } };
  }

  const inserted = await sql<{ id: number }[]>`
    insert into word_suggestions (word_id, player_id)
    values (${wordRow.id}, ${playerId})
    returning id
  `;

  // Same insert-then-count-then-undo shape as lib/game.ts's guess() rate limit, and for
  // the same reason: counting before the insert lets concurrent requests all read "under
  // the limit" and all pass, since none of them see each other's row yet.
  const [{ count }] = await sql<{ count: number }[]>`
    select count(*)::int as count
      from word_suggestions
     where player_id = ${playerId} and created_at >= now() - interval '1 day'
  `;
  if (count > MAX_SUGGESTIONS_PER_DAY) {
    await sql`delete from word_suggestions where id = ${inserted[0].id}`;
    await sql`delete from words where id = ${wordRow.id}`;
    return { status: 429, body: { detail: "Túl sok javaslat egy nap alatt. Próbáld holnap." } };
  }

  return { status: 200, body: { suggested: true, already_present: false } };
}
