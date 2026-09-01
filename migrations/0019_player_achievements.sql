-- Betűvető — achievements (ROADMAP Batch 10 item 10)
--
-- One row per (player, achievement) the moment that achievement is first earned. The
-- catalog of achievement keys lives in code (lib/achievements.ts), not in a table — the
-- set is small, versioned with the app, and each key needs a matching predicate anyway.
--
-- Data-source note (confirmed 2026-08-30, no new tracking columns needed): every
-- predicate reads a table that already exists —
--   * game_guesses.correct        → "first word found", "found a 10-letter word"
--   * games.status = 'finished'    → "full board clear"
--   * game_hints (row count)       → "full clear with no hints"
--   * daily_results + computeStreak → "7-day / 30-day daily streak"
--   * games (terminal-status count) → "100 games played"
--   * daily_results × daily_puzzles → "daily completed in both wordlists"
--
-- Awards are forward-only (project owner's call, 2026-09-01): no retroactive backfill on
-- deploy. The cumulative predicates (games played, streaks) still catch up naturally on a
-- player's next terminal game; the point-in-time ones (first word, 10-letter word, full
-- clear) only fire on a game played after this ships.
--
-- Purely additive; applied the same way as 0001-0018 (npm run db:migrate).

create table public.player_achievements (
    player_id       uuid        not null references public.players (id) on delete cascade,
    achievement_key text        not null,
    unlocked_at     timestamptz not null default now(),
    primary key (player_id, achievement_key)
);

comment on table public.player_achievements is
    'One row per (player, achievement) at first-earn time (ROADMAP Batch 10 item 10). '
    'Achievement keys are defined in code (lib/achievements.ts). ON DELETE CASCADE so '
    'DELETE /api/v1/me needs no special handling for this table.';

-- The read path is always "all achievements for one player" (GET /api/v1/me/achievements
-- and the evaluate-then-insert at a game's terminal transition).
create index player_achievements_player_idx on public.player_achievements (player_id);
