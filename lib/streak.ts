/**
 * Daily-puzzle streak computation (ROADMAP Batch 10 item 1).
 *
 * Extracted from lib/daily.ts so lib/achievements.ts can reuse it without pulling in the
 * whole daily module (which imports lib/game.ts, and lib/game.ts imports achievements —
 * a cycle this split avoids). Pure SQL + integer date math, no other lib/ dependencies.
 */
import type { Sql } from "postgres";

export interface StreakInfo {
  current: number;
  best: number;
}

/** Number of whole days from the epoch for a 'YYYY-MM-DD' string — lets streak logic do
 *  plain integer differences without constructing timezone-sensitive Date objects. */
export function dayNumber(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Current + best run of consecutive Budapest days on which this player *completed* a
 *  daily puzzle (any wordlist/length combo counts). The current run may end **today or
 *  yesterday** — so a player who hasn't played yet today still sees their real streak
 *  rather than 0 — and a gap of >= 2 days breaks it. */
export async function computeStreak(sql: Sql, playerId: string): Promise<StreakInfo> {
  const rows = await sql<{ d: string }[]>`
    select distinct dp.puzzle_date::text as d
      from daily_results dr
      join daily_puzzles dp on dp.id = dr.puzzle_id
     where dr.player_id = ${playerId} and dr.completed
     order by d desc
  `;
  if (rows.length === 0) return { current: 0, best: 0 };

  const [{ today }] = await sql<{ today: string }[]>`
    select (now() at time zone 'Europe/Budapest')::date::text as today
  `;
  const todayNum = dayNumber(today);
  const nums = rows.map((r) => dayNumber(r.d)); // distinct, descending

  let current = 0;
  if (todayNum - nums[0] <= 1) {
    current = 1;
    for (let i = 0; i < nums.length - 1; i++) {
      if (nums[i] - nums[i + 1] === 1) current++;
      else break;
    }
  }

  let best = 1;
  let run = 1;
  for (let i = 0; i < nums.length - 1; i++) {
    if (nums[i] - nums[i + 1] === 1) {
      run++;
      best = Math.max(best, run);
    } else {
      run = 1;
    }
  }

  return { current, best };
}
