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
import { getConfig } from "./config.js";
import { db, wordlistId } from "./db.js";
import type { Reply } from "./game.js";
import { normalizeWord } from "./words.js";

/*
 * Abuse limits (ROADMAP 12.2, all three admin-editable in lib/config.ts). Player identity
 * is a free anonymous cookie, so "N distinct players" alone could be one person with N
 * browser profiles retiring any word they like. Two changes keep the auto-inactivation
 * useful for a wider audience without making anyone sign in:
 *   - only *trusted* reporters count toward it: a player with at least
 *     report_min_completed_games finished games in which they found at least one word.
 *     Everyone's report is still recorded and still shows up in the admin queue — an
 *     untrusted report just can't pull a word out of play on its own;
 *   - a per-player cap of reports_per_player_per_day (rolling 24 h).
 */

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
  const config = await getConfig();
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

  // Daily cap: insert-then-count-then-undo, the same concurrency-safe shape as guess()'s
  // rate limit and suggestWord()'s daily cap — counting first would let parallel requests
  // all read "under the cap".
  if (config.reports_per_player_per_day > 0) {
    const [{ recent }] = await sql<{ recent: number }[]>`
      select count(*)::int as recent from word_reports
       where player_id = ${playerId} and created_at >= now() - interval '24 hours'
    `;
    if (recent > config.reports_per_player_per_day) {
      await sql`delete from word_reports where id = ${inserted[0].id}`;
      return { status: 429, body: { detail: "rate_limited" } };
    }
  }

  // Auto-inactivation (ROADMAP 4.1, tightened in 12.2): enough *distinct, trusted*
  // players with an open report. One player can't count twice (the unique index caps
  // them at one row), and a throwaway identity doesn't count at all. Active games keep
  // their own target regardless (see lib/game.ts's guess() exception for
  // `word = game.target_word`).
  const [{ count }] = await sql<{ count: number }[]>`
    select count(distinct wr.player_id)::int as count
      from word_reports wr
     where wr.word_id = ${row.id} and wr.status = 'open'
       and (select count(*) from games g
             where g.player_id = wr.player_id
               and g.status in ('finished', 'expired', 'given_up')
               and g.found_count > 0) >= ${config.report_min_completed_games}
  `;

  let deactivated = !row.active;
  const threshold = config.report_auto_inactivate_threshold;
  if (!deactivated && threshold > 0 && count >= threshold) {
    await sql`update words set active = false where id = ${row.id}`;
    deactivated = true;
  }

  return { status: 200, body: { reported: true, already_reported: false, deactivated } };
}
