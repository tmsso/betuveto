-- Betűvető — multiplayer rooms, lobby (ROADMAP 7.2.2)
--
-- A room is an ad-hoc daily puzzle: this table holds the shared board + deadline (the
-- same shape as daily_puzzles), every member plays an ordinary games row with the new
-- games.room_id below, and the only new gameplay logic (7.2.3+) is a collective-clear /
-- everyone-done hook. Guess, hints, rescramble, expiry, word_stats and achievements are
-- reused unchanged. Full design: docs/multiplayer.md.
--
-- Purely additive; applied the same way as 0001-0019 (npm run db:migrate).

create table public.rooms (
    id                uuid        primary key default gen_random_uuid(),
    code              text        not null unique, -- 6 chars, ABCDEFGHJKMNPQRSTUVWXYZ23456789
    host_player_id    uuid        references public.players (id) on delete set null,
    wordlist_id       bigint      not null references public.wordlists (id),
    target_length     int         not null check (target_length between 5 and 10),
    mode              text        not null default 'coop' check (mode in ('coop', 'versus')),
    status            text        not null default 'lobby'
                                    check (status in ('lobby', 'playing', 'finished', 'cancelled')),
    -- The board, null until start (7.2.3) — same columns as daily_puzzles.
    target_word       text,
    scrambled_letters text,
    possible_count    int,
    started_at        timestamptz,
    ends_at           timestamptz,
    ended_at          timestamptz,
    next_room_code    text, -- rematch pointer (7.2.6+), set by the host
    created_at        timestamptz not null default now()
);

comment on table public.rooms is
    'A multiplayer room: shared board + deadline once started (ROADMAP 7.2). '
    'host_player_id ON DELETE SET NULL so DELETE /api/v1/me leaves a host-less lobby room, '
    'which reads as cancelled rather than erroring.';

create index rooms_status_created_idx on public.rooms (status, created_at);

create table public.room_players (
    room_id      uuid        not null references public.rooms (id)   on delete cascade,
    player_id    uuid        not null references public.players (id) on delete cascade,
    game_id      uuid        references public.games (id) on delete set null, -- set once started (7.2.3)
    joined_at    timestamptz not null default now(),
    last_seen_at timestamptz not null default now(), -- lobby presence ("online" in the snapshot)
    primary key (room_id, player_id)
);

comment on table public.room_players is
    'Room membership. ON DELETE CASCADE on both FKs — an account deletion or a deleted '
    'room needs no special-case cleanup here.';

alter table public.games add column room_id uuid references public.rooms (id) on delete set null;

comment on column public.games.room_id is
    'Set for a room member''s game (ROADMAP 7.2.3+); null for an ordinary single-player or '
    'daily game. lib/scores.ts filters room games off the single-player leaderboards.';

create index games_room_idx on public.games (room_id) where room_id is not null;
