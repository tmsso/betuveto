-- ROADMAP Batch 10 item 11: flag CI-minted players out of dashboard metrics.
--
-- The E2E smoke test (Batch 10 item 5) plays one real game against production on every
-- CI run, so games/day and DAU on the admin dashboard have silently included CI traffic
-- since that test shipped. `is_ci` is set manually, the same bootstrap pattern this
-- project already uses for `players.is_admin` (ROADMAP 5.1) — never via any API, so
-- nothing can grant itself exclusion from the dashboard's own metrics.
alter table public.players
    add column is_ci boolean not null default false;

comment on column public.players.is_ci is
    'True for the single pinned identity the E2E smoke test (ROADMAP Batch 10 item 5) reuses '
    'across CI runs. Set by hand, never via the API. The admin dashboard (5.2 item 4) excludes '
    'is_ci players from games/day and DAU.';
