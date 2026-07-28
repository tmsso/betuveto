-- Betűvető — leaderboard disqualification (ROADMAP Batch 5.2 item 3)
--
-- A nullable timestamp rather than a new `games.status` enum value: the game's real
-- lifecycle status ("this finished legitimately") is worth keeping distinct from an
-- admin's later leaderboard decision, and this avoids touching the games_status_check
-- constraint or auditing every existing status === 'active' branch in lib/game.ts.
-- Purely additive, applied the same way as 0001-0005 (npm run db:migrate).

alter table public.games add column disqualified_at timestamptz;

comment on column public.games.disqualified_at is
    'Set by an admin to remove a finished game from the leaderboard without deleting its history (ROADMAP 5.2 item 3). Null means eligible.';
