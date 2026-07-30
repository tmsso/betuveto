/**
 * Per-player word history (ROADMAP Batch 3.3): the server-side replacement for the
 * frontend's localStorage "Előzmények" list, and the same data the failed-word
 * reappearance weighting (ROADMAP Batch 10) will read from later. `lib/game.ts` writes
 * to this on every game-ending transition; this module also serves GET /api/v1/me/stats.
 *
 * Keyed per (player, wordlist, word) since migrations/0009 (ROADMAP 6.1) — a spelling
 * common to two languages must not merge its failed/solved counts across them.
 */
import type { Sql } from "postgres";
import { db } from "./db.js";
import type { Reply } from "./game.js";

/** A correct guess of the target word — recorded once, the instant it happens. */
export async function recordSolved(
  sql: Sql,
  playerId: string | null,
  wordlistId: number,
  word: string,
): Promise<void> {
  if (!playerId) return;
  await sql`
    insert into word_stats (player_id, wordlist_id, word, times_solved)
    values (${playerId}, ${wordlistId}, ${word}, 1)
    on conflict (player_id, wordlist_id, word)
    do update set times_solved = word_stats.times_solved + 1
  `;
}

/** A game that ended (expired / given up) without the target ever being found. */
export async function recordFailed(
  sql: Sql,
  playerId: string | null,
  wordlistId: number,
  word: string,
): Promise<void> {
  if (!playerId) return;
  await sql`
    insert into word_stats (player_id, wordlist_id, word, times_failed)
    values (${playerId}, ${wordlistId}, ${word}, 1)
    on conflict (player_id, wordlist_id, word)
    do update set times_failed = word_stats.times_failed + 1
  `;
}

/** Whether this player has ever failed this word before — feeds `is_previously_failed`
 *  on game/start (ROADMAP 0.1's flag, previously always false pre-Batch-3.3). */
export async function hasFailedBefore(
  playerId: string,
  wordlistId: number,
  word: string,
): Promise<boolean> {
  const sql = db();
  const [row] = await sql<{ x: number }[]>`
    select 1 as x from word_stats
     where player_id = ${playerId} and wordlist_id = ${wordlistId}
       and word = ${word} and times_failed > 0
  `;
  return !!row;
}

// ROADMAP Batch 10 "difficulty rating per word": word_stats already accrues exactly the
// signal this needs — recordSolved/recordFailed only ever fire for a game's *target* word
// (lib/game.ts), so summed across all players it's directly "% of games where the target
// was found." A word that's only ever been a target once or twice would read as an
// artificial 0% or 100%, so both consumers below require a minimum sample before trusting
// the rate.
//
// Known limitation, confirmed against production 2026-07-30: with uniform-random target
// selection over a wordlist this size (hu ~152k, en ~270k words), a single word reaching 5
// attempts takes a very large number of games at hobby-project traffic — production's own
// most-attempted word sat at 1 attempt the day this shipped. getHardestWords() and
// pickEasyWord() are therefore both effectively inert right now (empty / always falling
// back), not merely slow to warm up — this will not visibly self-correct on its own
// timescale. Revisit before relying on either: lower this threshold (weakens the
// anti-noise guarantee above), or seed difficulty from a different signal entirely (e.g.
// word frequency/rarity in the source corpus) rather than waiting on live-play volume.
export const MIN_ATTEMPTS_FOR_DIFFICULTY = 5;
export const EASY_MODE_SUCCESS_THRESHOLD = 0.6;

export interface WordDifficultyRow {
  word: string;
  wordlist: string;
  times_failed: number;
  times_solved: number;
  success_rate: number;
}

/** Words with the lowest aggregate success rate, across all players, scoped per wordlist
 *  since a spelling shared between two languages (ROADMAP 6.1) must not merge its stats —
 *  the same scoping bug fixed here that getMyStats's failed_words already had to fix. */
export async function getHardestWords(limit: number): Promise<WordDifficultyRow[]> {
  const sql = db();
  return sql<WordDifficultyRow[]>`
    select ws.word, wl.code as wordlist,
           sum(ws.times_failed)::int as times_failed,
           sum(ws.times_solved)::int as times_solved,
           (sum(ws.times_solved)::float / (sum(ws.times_solved) + sum(ws.times_failed))) as success_rate
      from word_stats ws
      join wordlists wl on wl.id = ws.wordlist_id
     group by ws.wordlist_id, ws.word, wl.code
    having sum(ws.times_solved) + sum(ws.times_failed) >= ${MIN_ATTEMPTS_FOR_DIFFICULTY}
     order by success_rate asc, times_failed desc, ws.word
     limit ${limit}
  `;
}

/** Picks an active word of the given wordlist+length with a proven high success rate
 *  across every player's past games as its target — the "easy mode" word-selection bias.
 *  Returns null when nothing yet qualifies (a fresh wordlist/length combo, or simply early
 *  in this feature's life before enough history has accrued); callers fall back to the
 *  normal uniform-random pick. That's an accepted, self-correcting cold start rather than
 *  a bug — the qualifying pool only grows as more games are played (ROADMAP Batch 10: "data
 *  starts accruing the moment Batch 1 lands, so log now, build later"). */
export async function pickEasyWord(
  sql: Sql,
  wordlistId: number,
  length: number,
): Promise<string | null> {
  const [row] = await sql<{ word: string }[]>`
    select w.word
      from words w
      join word_stats ws on ws.wordlist_id = w.wordlist_id and ws.word = w.word
     where w.wordlist_id = ${wordlistId} and w.length = ${length} and w.active
     group by w.word
    having sum(ws.times_solved) + sum(ws.times_failed) >= ${MIN_ATTEMPTS_FOR_DIFFICULTY}
       and sum(ws.times_solved)::float / (sum(ws.times_solved) + sum(ws.times_failed))
             >= ${EASY_MODE_SUCCESS_THRESHOLD}
     order by random()
     limit 1
  `;
  return row?.word ?? null;
}

interface StatsRow {
  games_played: number;
  completion_rate: number | null;
}

interface AvgScoreRow {
  target_length: number;
  avg_score: number;
}

interface LongestWordRow {
  word: string;
}

interface FailedWordRow {
  word: string;
  wordlist: string;
  times_failed: number;
  times_solved: number;
}

const EMPTY_STATS = {
  games_played: 0,
  completion_rate: 0,
  average_score_by_length: {} as Record<number, number>,
  longest_word_found: null as string | null,
  failed_words: [] as FailedWordRow[],
};

/** No identity (never played, or a stale/missing cookie) reads as an empty stats sheet
 *  rather than an error — same convention as lib/players.ts's getPreferredLength. */
export async function getMyStats(playerId: string | null): Promise<Reply> {
  if (!playerId) return { status: 200, body: EMPTY_STATS };

  const sql = db();

  // "Played to a decision" = finished, given_up, or expired; `active`/`abandoned` games
  // have no verdict yet, so they count toward neither the total nor the rate.
  const [summary] = await sql<StatsRow[]>`
    select count(*)::int as games_played,
           (count(*) filter (where status = 'finished'))::float / nullif(count(*), 0) as completion_rate
      from games
     where player_id = ${playerId} and status in ('finished', 'given_up', 'expired')
  `;

  const avgByLength = await sql<AvgScoreRow[]>`
    select target_length, avg(final_score)::float as avg_score
      from games
     where player_id = ${playerId} and status = 'finished'
     group by target_length
     order by target_length
  `;

  const [longest] = await sql<LongestWordRow[]>`
    select gg.word
      from game_guesses gg
      join games g on g.id = gg.game_id
     where g.player_id = ${playerId} and gg.correct
     order by length(gg.word) desc
     limit 1
  `;

  // Joined to wordlists for its code (ROADMAP 6.1 widened this table's key to
  // (player_id, wordlist_id, word), so a spelling shared by two languages, e.g. "ALMA",
  // is now two distinct rows here — the code lets the frontend key/label them apart
  // instead of colliding on `word` alone, which is a duplicate React key, not a display
  // choice).
  const failedWords = await sql<FailedWordRow[]>`
    select ws.word, wl.code as wordlist, ws.times_failed, ws.times_solved
      from word_stats ws
      join wordlists wl on wl.id = ws.wordlist_id
     where ws.player_id = ${playerId} and ws.times_failed > 0
     order by ws.times_failed desc, ws.word
     limit 50
  `;

  return {
    status: 200,
    body: {
      games_played: summary?.games_played ?? 0,
      completion_rate: summary?.completion_rate ?? 0,
      average_score_by_length: Object.fromEntries(
        avgByLength.map((row) => [row.target_length, row.avg_score]),
      ),
      longest_word_found: longest?.word ?? null,
      failed_words: failedWords,
    },
  };
}
