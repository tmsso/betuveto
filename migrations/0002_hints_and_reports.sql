-- Betűvető — hints and word curation (ROADMAP Batch 3.1, 4.1)
--
-- Both tables are purely additive: no existing column or row is touched. Applied the
-- same way as 0001 (npm run db:migrate), tracked in schema_migrations.

-- ---------------------------------------------------------------------------
-- game_hints — every hint taken, so cost can be deducted from a game's score and the
-- leaderboard can show a marker for hinted games (ROADMAP 3.1).
-- ---------------------------------------------------------------------------
create table public.game_hints (
    id         bigint generated always as identity primary key,
    game_id    uuid        not null references public.games (id) on delete cascade,
    word       text        not null,
    position   integer     not null default 1,
    letter     text        not null,
    cost       integer     not null,
    created_at timestamptz not null default now()
);

comment on table public.game_hints is
    'One row per hint taken. cost is deducted from the game''s score (floored at 0); the leaderboard flags any game with at least one row here.';

create index game_hints_game_idx on public.game_hints (game_id);

-- ---------------------------------------------------------------------------
-- word_reports — players flagging a word as wrong (ROADMAP 4.1). A word is
-- auto-inactivated once it accrues >= 2 open reports from distinct players; the API
-- enforces that threshold, not the schema.
-- ---------------------------------------------------------------------------
create table public.word_reports (
    id         bigint generated always as identity primary key,
    word_id    bigint      not null references public.words (id) on delete cascade,
    player_id  uuid        not null references public.players (id) on delete cascade,
    reason     text,
    status     text        not null default 'open'
                    check (status in ('open', 'accepted', 'rejected')),
    created_at timestamptz not null default now(),
    unique (word_id, player_id)
);

comment on table public.word_reports is
    'Player reports of a word being wrong. unique(word_id, player_id) caps one report per player per word; admin review (Batch 5) sets status to accepted/rejected.';

create index word_reports_word_open_idx on public.word_reports (word_id) where status = 'open';
