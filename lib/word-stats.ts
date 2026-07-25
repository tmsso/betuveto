/**
 * Per-player word history (ROADMAP Batch 3.3): the server-side replacement for the
 * frontend's localStorage "Előzmények" list, and the same data the failed-word
 * reappearance weighting (ROADMAP Batch 10) will read from later. `lib/game.ts` writes
 * to this on every game-ending transition; this module also serves GET /api/v1/me/stats.
 */
import type { Sql } from "postgres";
import { db } from "./db.js";
import type { Reply } from "./game.js";

/** A correct guess of the target word — recorded once, the instant it happens. */
export async function recordSolved(sql: Sql, playerId: string | null, word: string): Promise<void> {
  if (!playerId) return;
  await sql`
    insert into word_stats (player_id, word, times_solved)
    values (${playerId}, ${word}, 1)
    on conflict (player_id, word) do update set times_solved = word_stats.times_solved + 1
  `;
}

/** A game that ended (expired / given up) without the target ever being found. */
export async function recordFailed(sql: Sql, playerId: string | null, word: string): Promise<void> {
  if (!playerId) return;
  await sql`
    insert into word_stats (player_id, word, times_failed)
    values (${playerId}, ${word}, 1)
    on conflict (player_id, word) do update set times_failed = word_stats.times_failed + 1
  `;
}

/** Whether this player has ever failed this word before — feeds `is_previously_failed`
 *  on game/start (ROADMAP 0.1's flag, previously always false pre-Batch-3.3). */
export async function hasFailedBefore(playerId: string, word: string): Promise<boolean> {
  const sql = db();
  const [row] = await sql<{ x: number }[]>`
    select 1 as x from word_stats where player_id = ${playerId} and word = ${word} and times_failed > 0
  `;
  return !!row;
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

  const failedWords = await sql<FailedWordRow[]>`
    select word, times_failed, times_solved
      from word_stats
     where player_id = ${playerId} and times_failed > 0
     order by times_failed desc, word
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
