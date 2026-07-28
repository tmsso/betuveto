-- Betűvető — admin dashboard support indexes (ROADMAP Batch 5.2 item 4)
--
-- Purely additive, applied the same way as 0001-0006 (npm run db:migrate). Both indexes
-- exist only so the dashboard's aggregate queries stay index-backed instead of scanning
-- their whole table as either grows (architecture decision 10's 10s function budget).

-- games/day + DAU query joins a 30-day generate_series against games on a started_at
-- range per day; without this, that join falls back to a sequential scan of every game
-- ever played.
create index games_started_at_idx on public.games (started_at);

-- Mirrors word_reports_word_open_idx (migration 0003): the queue-size count only ever
-- needs open rows, so a partial index keeps it index-only instead of scanning every
-- suggestion regardless of status.
create index word_suggestions_open_idx on public.word_suggestions (id) where status = 'open';
