/**
 * Word curation: flagging an accepted word as wrong (ROADMAP Batch 4.1).
 *
 * Deviation from the roadmap's literal `POST /api/v1/words/{word_id}/report`: the
 * frontend never receives word ids anywhere in the existing API surface (words are
 * always referenced by their text — found-word chips, possible-word lists, guesses), so
 * this takes `{ word, wordlist? }` in the JSON body instead and resolves the id
 * server-side. Flagged here and in the PR description per usual practice for a deviation
 * from the written spec.
 */
import { db, wordlistId } from "./db.js";
import type { Reply } from "./game.js";
import { normalizeWord } from "./words.js";

/** Distinct-player open reports before a word is auto-inactivated. */
const AUTO_INACTIVATE_THRESHOLD = 2;

export async function reportWord(
  playerId: string | null,
  rawWord: unknown,
  wordlistCode: string,
  rawReason: unknown,
): Promise<Reply> {
  if (!playerId) {
    return { status: 401, body: { detail: "No player identity. Start a game first." } };
  }
  if (typeof rawWord !== "string") {
    return { status: 422, body: { detail: "word must be a string." } };
  }
  const word = normalizeWord(rawWord);
  if (!word) {
    return { status: 422, body: { detail: "word is not a valid word." } };
  }
  if (rawReason !== undefined && rawReason !== null && typeof rawReason !== "string") {
    return { status: 422, body: { detail: "reason must be a string." } };
  }

  const sql = db();
  const listId = await wordlistId(wordlistCode);

  const [row] = await sql<{ id: number; active: boolean }[]>`
    select id, active from words where wordlist_id = ${listId} and word = ${word}
  `;
  if (!row) return { status: 404, body: { detail: `Unknown word: ${word}` } };

  // One report per player per word (unique index): a repeat report is a no-op, not an
  // error — the frontend can call this idempotently without checking state first.
  const inserted = await sql<{ id: number }[]>`
    insert into word_reports (word_id, player_id, reason)
    values (${row.id}, ${playerId}, ${typeof rawReason === "string" ? rawReason : null})
    on conflict (word_id, player_id) do nothing
    returning id
  `;
  if (inserted.length === 0) {
    return { status: 200, body: { reported: true, already_reported: true, deactivated: !row.active } };
  }

  // Auto-inactivation (ROADMAP 4.1): >= 2 *distinct* players with an open report — a
  // single user can't retire a word by reporting it twice, since the unique index already
  // caps them at one row. Active games keep their own target regardless (see lib/game.ts's
  // guess() exception for `word = game.target_word`).
  const [{ count }] = await sql<{ count: number }[]>`
    select count(distinct player_id)::int as count
      from word_reports
     where word_id = ${row.id} and status = 'open'
  `;

  let deactivated = !row.active;
  if (!deactivated && count >= AUTO_INACTIVATE_THRESHOLD) {
    await sql`update words set active = false where id = ${row.id}`;
    deactivated = true;
  }

  return { status: 200, body: { reported: true, already_reported: false, deactivated } };
}
