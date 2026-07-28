-- Betűvető — admin-editable gameplay config (ROADMAP Batch 5.2 item 2)
--
-- Moves the constants that were hardcoded in lib/game.ts / lib/hints.ts / lib/words.ts
-- into a table an admin can edit without a redeploy. `value` is jsonb holding a plain
-- number per key; lib/config.ts validates and caches reads (see its own doc comment).
-- Purely additive, applied the same way as 0001-0004 (npm run db:migrate).

create table public.config (
    key        text primary key,
    value      jsonb       not null,
    updated_at timestamptz not null default now()
);

comment on table public.config is
    'Admin-editable gameplay knobs (ROADMAP 5.2 item 2). One row per key; lib/config.ts owns the known-key list and typed defaults.';

-- Seeded with the exact values that were previously compiled-in constants, so this
-- migration is a no-op on behaviour until an admin actually changes one.
insert into public.config (key, value) values
    ('hint_cost', '10'),
    ('completion_bonus_multiplier', '1'),
    ('guess_rate_limit_per_second', '3'),
    ('min_word_length', '3'),
    ('timer_base_seconds', '120'),
    ('timer_seconds_per_extra_length', '15');
