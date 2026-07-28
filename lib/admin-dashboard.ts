/**
 * Read-only admin dashboard (ROADMAP Batch 5.2 item 4): games/day, DAU, most-failed
 * words, report queue size. No mutations, so no logAdminAction call — unlike every other
 * admin-* module, there's nothing here for the audit log to attribute.
 */
import { db } from "./db.js";
import type { Reply } from "./game.js";

const DAILY_WINDOW_DAYS = 30;
const MOST_FAILED_LIMIT = 20;

interface DailyRow {
  date: string;
  games: number;
  dau: number;
}

interface FailedWordRow {
  word: string;
  times_failed: number;
  times_solved: number;
}

export async function getDashboardStats(): Promise<Reply> {
  const sql = db();

  // One row per day for the trailing window, zero-filled via generate_series so a quiet
  // day shows as 0 rather than a gap. The join condition is a per-day range on
  // games.started_at (not date_trunc(started_at) = d) specifically so the
  // games_started_at_idx index applies per day instead of forcing a sequential scan.
  const daily = await sql<DailyRow[]>`
    select d::date::text as date,
           count(g.id)::int as games,
           count(distinct g.player_id)::int as dau
      from generate_series(
             date_trunc('day', now()) - make_interval(days => ${DAILY_WINDOW_DAYS - 1}),
             date_trunc('day', now()),
             interval '1 day'
           ) as d
      left join games g
        on g.started_at >= d and g.started_at < d + interval '1 day'
     group by d
     order by d
  `;

  // Aggregated across all players — word_stats is per-(player, word), so a word failed
  // by many players needs summing, not just reading one row.
  const mostFailedWords = await sql<FailedWordRow[]>`
    select word, sum(times_failed)::int as times_failed, sum(times_solved)::int as times_solved
      from word_stats
     group by word
    having sum(times_failed) > 0
     order by times_failed desc, word
     limit ${MOST_FAILED_LIMIT}
  `;

  const [{ reports, suggestions }] = await sql<{ reports: number; suggestions: number }[]>`
    select
      (select count(*) from word_reports where status = 'open')::int as reports,
      (select count(*) from word_suggestions where status = 'open')::int as suggestions
  `;

  return {
    status: 200,
    body: {
      daily,
      most_failed_words: mostFailedWords,
      queue_size: { reports, suggestions },
    },
  };
}
