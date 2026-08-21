/**
 * Read-only admin dashboard (ROADMAP Batch 5.2 item 4): games/day, DAU, most-failed
 * words, report queue size. No mutations, so no logAdminAction call — unlike every other
 * admin-* module, there's nothing here for the audit log to attribute.
 */
import { db } from "./db.js";
import type { Reply } from "./game.js";
import { getHardestWords } from "./word-stats.js";

const DAILY_WINDOW_DAYS = 30;
const MOST_FAILED_LIMIT = 20;

interface DailyRow {
  date: string;
  games: number;
  dau: number;
}

interface FailedWordRow {
  word: string;
  wordlist: string;
  times_failed: number;
  times_solved: number;
}

export async function getDashboardStats(): Promise<Reply> {
  const sql = db();

  // One row per day for the trailing window, zero-filled via generate_series so a quiet
  // day shows as 0 rather than a gap. The join condition is a per-day range on
  // games.started_at (not date_trunc(started_at) = d) specifically so the
  // games_started_at_idx index applies per day instead of forcing a sequential scan.
  // Day boundaries are Europe/Budapest local, not the DB session's (UTC) day — Neon has
  // no reason to know the admin's timezone, so "today" is computed explicitly rather than
  // via a bare date_trunc(now()), which would put midnight up to 2h off from local time.
  // The CI exclusion lives in the join's ON clause, not a WHERE — a WHERE would drop a
  // day's zero-fill row entirely whenever its only games were CI's (ROADMAP Batch 10 item
  // 11: the E2E smoke test plays one real game against production on every CI run).
  const daily = await sql<DailyRow[]>`
    select (d at time zone 'Europe/Budapest')::date::text as date,
           count(g.id)::int as games,
           count(distinct g.player_id)::int as dau
      from generate_series(
             date_trunc('day', now() at time zone 'Europe/Budapest') at time zone 'Europe/Budapest'
               - make_interval(days => ${DAILY_WINDOW_DAYS - 1}),
             date_trunc('day', now() at time zone 'Europe/Budapest') at time zone 'Europe/Budapest',
             interval '1 day'
           ) as d
      left join games g
        on g.started_at >= d and g.started_at < d + interval '1 day'
       and not exists (select 1 from players p where p.id = g.player_id and p.is_ci)
     group by d
     order by d
  `;

  // Aggregated across all players — word_stats is per-(player, wordlist, word), so a word
  // failed by many players needs summing, not just reading one row. Scoped per wordlist
  // (joined to wordlists for its code) so a spelling shared between hu/en, e.g. "ALMA",
  // doesn't merge its counts across languages — the same bug getMyStats's failed_words had
  // to fix (ROADMAP 6.2 follow-up, PR #37); this query had it too, just never caught since
  // it's an admin-only view.
  const mostFailedWords = await sql<FailedWordRow[]>`
    select ws.word, wl.code as wordlist,
           sum(ws.times_failed)::int as times_failed, sum(ws.times_solved)::int as times_solved
      from word_stats ws
      join wordlists wl on wl.id = ws.wordlist_id
     group by ws.wordlist_id, ws.word, wl.code
    having sum(ws.times_failed) > 0
     order by times_failed desc, ws.word
     limit ${MOST_FAILED_LIMIT}
  `;

  // ROADMAP Batch 10 "difficulty rating per word": ranked by success rate (times_solved /
  // total attempts) rather than raw fail count, so a word played by a handful of people who
  // all struggled outranks a word merely played (and failed) by many.
  const hardestWords = await getHardestWords(MOST_FAILED_LIMIT);

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
      hardest_words: hardestWords,
      queue_size: { reports, suggestions },
    },
  };
}
