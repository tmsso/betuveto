/**
 * Server-side high scores (ROADMAP Batch 2.2). Read-only: `games.final_score` and
 * `games.status = 'finished'` are already written by lib/game.ts's guess() when a board
 * is fully cleared (see the `gameEnded` block there) — nothing here inserts anything.
 *
 * The query shape (wordlist_id, target_length, status='finished', order by final_score
 * desc, limit) is exactly what `games_leaderboard_idx` (migrations/0001_init.sql) was
 * built for; `period` filters on `ended_at` on top of that index scan rather than inside it.
 * `disqualified_at is null` (ROADMAP 5.2 item 3, migrations/0006) additionally excludes
 * games an admin removed from the board — the row and its history stay intact, only
 * visibility here changes.
 */
import type { Sql } from "postgres";
import { db, wordlistId } from "./db.js";
import type { Reply } from "./game.js";
import { MAX_TARGET_LENGTH, MIN_TARGET_LENGTH } from "./words.js";

export const TOP_SCORES_LIMIT = 10;

const PERIODS = ["all", "week", "day"] as const;
type Period = (typeof PERIODS)[number];

function isPeriod(value: string): value is Period {
  return (PERIODS as readonly string[]).includes(value);
}

// A null/blank display_name is common (Batch 2.1 made it optional) — never show a blank
// leaderboard row.
const ANONYMOUS_DISPLAY_NAME = "Névtelen játékos";

interface ScoreRow {
  display_name: string | null;
  final_score: number;
  ended_at: Date;
  hinted: boolean;
}

/** Seconds since the epoch, matching the shape the rest of the API returns timestamps in. */
function epochSeconds(at: Date): number {
  return at.getTime() / 1000;
}

/** `period=all` composes to an empty fragment; postgres.js supports interpolating a
 *  fragment built from a nested `sql` tag, so this stays one query either way. */
function periodFilter(sql: Sql, period: Period) {
  if (period === "week") return sql`and g.ended_at >= now() - interval '7 days'`;
  if (period === "day") return sql`and g.ended_at >= now() - interval '1 day'`;
  return sql``;
}

export async function getTopScores(
  targetLength: number,
  wordlistCode: string,
  periodRaw: string,
  // The requesting player's identity, resolved from the signed anon cookie by the caller
  // (null if absent/invalid) — never accepted as a client-supplied id, so nobody can query
  // someone else's "your best" by guessing a UUID.
  playerId: string | null,
): Promise<Reply> {
  if (
    !Number.isInteger(targetLength) ||
    targetLength < MIN_TARGET_LENGTH ||
    targetLength > MAX_TARGET_LENGTH
  ) {
    return {
      status: 422,
      body: {
        detail: `length must be an integer between ${MIN_TARGET_LENGTH} and ${MAX_TARGET_LENGTH}.`,
      },
    };
  }

  if (!isPeriod(periodRaw)) {
    return { status: 422, body: { detail: `period must be one of: ${PERIODS.join(", ")}.` } };
  }
  const period = periodRaw;

  const sql = db();
  const listId = await wordlistId(wordlistCode);
  const clause = periodFilter(sql, period);

  const rows = await sql<ScoreRow[]>`
    select p.display_name, g.final_score, g.ended_at,
           exists(select 1 from game_hints h where h.game_id = g.id) as hinted
      from games g
      left join players p on p.id = g.player_id
     where g.wordlist_id = ${listId}
       and g.target_length = ${targetLength}
       and g.status = 'finished'
       and g.disqualified_at is null
       ${clause}
     order by g.final_score desc
     limit ${TOP_SCORES_LIMIT}
  `;

  const top = rows.map((row) => ({
    display_name: row.display_name?.trim() || ANONYMOUS_DISPLAY_NAME,
    final_score: row.final_score,
    ended_at: epochSeconds(row.ended_at),
    // 💡 marker (ROADMAP 3.1): hinted games still count, but are flagged rather than
    // hidden — a separate "pure" leaderboard is a config toggle for later, not this batch.
    hinted: row.hinted,
  }));

  let yourBest: { final_score: number; ended_at: number } | null = null;
  if (playerId) {
    const [best] = await sql<{ final_score: number; ended_at: Date }[]>`
      select final_score, ended_at
        from games g
       where g.wordlist_id = ${listId}
         and g.target_length = ${targetLength}
         and g.status = 'finished'
         and g.disqualified_at is null
         and g.player_id = ${playerId}
         ${clause}
       order by g.final_score desc
       limit 1
    `;
    if (best) yourBest = { final_score: best.final_score, ended_at: epochSeconds(best.ended_at) };
  }

  return {
    status: 200,
    body: {
      wordlist: wordlistCode,
      target_length: targetLength,
      period,
      top,
      your_best: yourBest,
    },
  };
}
