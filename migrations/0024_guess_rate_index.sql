-- Betűvető — index for the per-second guess rate limit (ROADMAP 11.10)
--
-- lib/game.ts guess() counts the player's correct guesses from the last second after every
-- correct guess. EXPLAIN ANALYZE on a production copy (2026-10-15, 890 game_guesses rows,
-- 0.12 ms) showed the planner doing a sequential scan of the WHOLE game_guesses table —
-- filtering `correct and created_at >= now() - 1s` first, then probing games by pkey — so
-- its cost grows with every player's history, not just this player's. This partial index
-- turns it into a range read of the last second's correct guesses, whatever the table size.
--
-- Purely additive; nothing depends on it, so code and migration can ship in either order.
-- Not CONCURRENTLY: scripts/migrate.ts runs each file in a transaction, and the table is
-- small enough that the brief write lock is a non-issue.

create index game_guesses_correct_recent_idx
    on public.game_guesses (created_at)
    where correct;
