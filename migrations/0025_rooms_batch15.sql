-- Betűvető — room test findings (ROADMAP Batch 15)
--
-- One migration for the whole batch, so the owner runs db:migrate once. Everything is
-- additive with a default, so it is safe to apply BEFORE the code that uses it ships.
--
--   solo_bonus_at / solo_ack_at   15.4 "left alone": when the +5 s interruption bonus was
--                                 granted (at most once per room) and when the lone player
--                                 chose "continue" (so the prompt does not come back).
--   visibility                    15.1 co-op variant, chosen by the host at creation.
--                                 'private' = today's behaviour (nobody sees others' words,
--                                 a word found by two players counts for both); 'shared' =
--                                 everyone sees found words and each word scores once.
--   room_word_claims              15.1 shared mode only: one row per (room, word). The
--                                 primary key is what makes "first finder scores" atomic
--                                 when two players submit the same word at the same moment
--                                 (game_guesses is unique per game, not per room).

alter table public.rooms
    add column solo_bonus_at timestamptz,
    add column solo_ack_at   timestamptz,
    add column visibility    text not null default 'private'
                               check (visibility in ('private', 'shared'));

comment on column public.rooms.solo_bonus_at is
    'When the +5 s "left alone" bonus was granted to the last active member (ROADMAP 15.4). '
    'Null until then; the guarded UPDATE that sets it makes the grant happen at most once.';
comment on column public.rooms.solo_ack_at is
    'When the last active member chose to continue alone. Null until then.';
comment on column public.rooms.visibility is
    'Co-op variant (ROADMAP 15.1): private (own words only) or shared (found words visible '
    'to all, first finder scores). Ignored for versus rooms.';

create table public.room_word_claims (
    room_id    uuid        not null references public.rooms (id) on delete cascade,
    word       text        not null,
    game_id    uuid        not null references public.games (id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (room_id, word)
);

comment on table public.room_word_claims is
    'Shared-visibility rooms only (ROADMAP 15.1): which member game found each word first. '
    'The (room_id, word) primary key arbitrates simultaneous submissions.';
