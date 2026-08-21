/**
 * Read-only admin dashboard (ROADMAP Batch 5.2 item 4): games/day, DAU, most-failed
 * words, report queue size, plus the Batch 10 item 13 player-stat drill-down (avg games/
 * duration per player, time-bucketed views, country distribution). No mutations, so no
 * logAdminAction call — unlike every other admin-* module, there's nothing here for the
 * audit log to attribute.
 */
import type { Sql } from "postgres";
import { db } from "./db.js";
import type { Reply } from "./game.js";
import { getHardestWords } from "./word-stats.js";

const DAILY_WINDOW_DAYS = 30;
const MOST_FAILED_LIMIT = 20;
const COUNTRY_LIMIT = 15;
// A game must have reached one of these to count toward duration/games-per-player stats
// (Batch 10 item 13) — the same "played to a decision" convention lib/word-stats.ts
// already uses for its own mastery calculation. An `active` game has no real duration yet
// (still running) and `abandoned` is swept without ever getting a terminal timestamp.
const TERMINAL_STATUSES = ["finished", "given_up", "expired"] as const;
// Every query below excludes is_ci players (ROADMAP Batch 10 item 11) — CI noise would
// skew a per-player average or a country distribution just as badly as it skewed
// games/day and DAU.
const EXCLUDE_CI = (sql: Sql) => sql`not exists (select 1 from players p where p.id = g.player_id and p.is_ci)`;

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

interface BucketRow {
  bucket: string;
  games: number;
  dau: number;
}

interface CountryRow {
  country: string;
  games: number;
}

interface PlayerStatsRow {
  avg_games_per_player: number;
  avg_game_duration_seconds: number;
}

/** One reusable primitive (ROADMAP Batch 10 item 13's own "2-3 reusable primitives"
 *  framing): games/DAU counted per calendar bucket. `date_trunc`'s field argument takes a
 *  plain text value, so 'month'/'quarter' bind safely as an ordinary parameter — no raw
 *  SQL interpolation needed to share this one query between both granularities. */
async function bucketedByCalendar(sql: Sql, field: "month" | "quarter"): Promise<BucketRow[]> {
  return sql<BucketRow[]>`
    select (date_trunc(${field}, g.started_at at time zone 'Europe/Budapest'))::date::text as bucket,
           count(g.id)::int as games, count(distinct g.player_id)::int as dau
      from games g
     where ${EXCLUDE_CI(sql)}
     group by 1
     order by 1
  `;
}

/** Hour-of-day (0-23), all days combined — an engagement-pattern view, not a trend line,
 *  so it needs `extract`, not `date_trunc`, and no zero-fill window like the daily series
 *  above (every hour bucket that ever had a game shows up; a silent hour just doesn't). */
async function bucketedByHour(sql: Sql): Promise<BucketRow[]> {
  return sql<BucketRow[]>`
    select extract(hour from g.started_at at time zone 'Europe/Budapest')::int::text as bucket,
           count(g.id)::int as games, count(distinct g.player_id)::int as dau
      from games g
     where ${EXCLUDE_CI(sql)}
     group by extract(hour from g.started_at at time zone 'Europe/Budapest')
     order by extract(hour from g.started_at at time zone 'Europe/Budapest')
  `;
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
       and ${EXCLUDE_CI(sql)}
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

  // ROADMAP Batch 10 item 13 — the other reusable primitive: a plain grouped-count
  // distribution, reused here for country and structurally identical to whatever the next
  // "top N by some column" admin view needs. country is only populated on games started
  // after this item shipped (migrations/0015), so older rows fall into 'UNKNOWN' — a real
  // gap being backfilled by new traffic, not a bug.
  const countries = await sql<CountryRow[]>`
    select coalesce(g.country, 'UNKNOWN') as country, count(*)::int as games
      from games g
     where ${EXCLUDE_CI(sql)}
     group by 1
     order by games desc, country
     limit ${COUNTRY_LIMIT}
  `;

  // Two-level average, deliberately not a flat games-count / distinct-players ratio for
  // duration: this equal-weights every qualifying player once (their own average game
  // duration) before averaging across players, so one hyperactive player's game count
  // can't dominate the figure the way a flat "total seconds / total games" would.
  // avg_games_per_player comes out identical either way (a straight average of per-player
  // counts *is* total/distinct-players), so there's no such distinction to make for it.
  const [playerStats] = await sql<PlayerStatsRow[]>`
    with qualifying as (
      select g.player_id,
             extract(epoch from (g.ended_at - g.started_at)) as duration_seconds
        from games g
       where g.status = any(${TERMINAL_STATUSES})
         and g.player_id is not null
         and ${EXCLUDE_CI(sql)}
    ),
    per_player as (
      select player_id, count(*)::float as games, avg(duration_seconds) as avg_duration
        from qualifying
       group by player_id
    )
    select coalesce(avg(games), 0)::float as avg_games_per_player,
           coalesce(avg(avg_duration), 0)::float as avg_game_duration_seconds
      from per_player
  `;

  const [gamesByMonth, gamesByQuarter, gamesByHour] = await Promise.all([
    bucketedByCalendar(sql, "month"),
    bucketedByCalendar(sql, "quarter"),
    bucketedByHour(sql),
  ]);

  return {
    status: 200,
    body: {
      daily,
      most_failed_words: mostFailedWords,
      hardest_words: hardestWords,
      queue_size: { reports, suggestions },
      player_stats: playerStats,
      games_by_month: gamesByMonth,
      games_by_quarter: gamesByQuarter,
      games_by_hour: gamesByHour,
      countries,
    },
  };
}
