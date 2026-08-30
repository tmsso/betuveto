-- Betűvető — daily puzzle + streaks (ROADMAP Batch 10 item 1)
--
-- One shared board per calendar day per (wordlist, length): everyone who plays "today's
-- puzzle" for a given combo gets the exact same scrambled letters and target word. The
-- day boundary is Europe/Budapest — computed as `(now() at time zone 'Europe/Budapest')
-- ::date` wherever a "today" is needed, so there is no timezone arithmetic in JS.
--
-- Design decisions (confirmed with the project owner, 2026-08-29):
--   * per-(wordlist, length) puzzle, not one global canonical daily
--   * a streak day = that day's puzzle *completed* (target word found), not merely played
--   * one graded attempt per day; the puzzle stays replayable for fun but only the first
--     attempt to reach a terminal state counts for the streak / leaderboard
--
-- "completed" = the target word was found. A Betűvető game only reaches status='finished'
-- on a *full board clear* (found_count >= possible_count), which is rare and would make
-- streaks near-unreachable — so completion is tracked here as "target found", independent
-- of whether the whole board was cleared.

create table public.daily_puzzles (
    id                bigint generated always as identity primary key,
    puzzle_date       date        not null,
    wordlist_id       bigint      not null references public.wordlists (id),
    target_length     int         not null,
    target_word       text        not null,
    scrambled_letters text        not null,
    possible_count    int         not null,
    created_at        timestamptz not null default now(),
    unique (puzzle_date, wordlist_id, target_length)
);

comment on table public.daily_puzzles is
    'One row per (calendar day, wordlist, length): the shared board every player gets for '
    'that day''s daily puzzle (ROADMAP Batch 10 item 1). Generated lazily on first request '
    'via INSERT ... ON CONFLICT DO NOTHING, then read back — never trust a pre-insert pick.';

-- A daily game is an ordinary `games` row with this column set. Every existing mechanic
-- (guess, give_up, hints, the server timer, lazy expiry finalization) operates on it
-- unchanged; only the terminal-transition hook (lib/game.ts finalizeWordStats) does
-- anything extra when it is non-null.
alter table public.games
    add column daily_puzzle_id bigint references public.daily_puzzles (id);

comment on column public.games.daily_puzzle_id is
    'Non-null on a daily-puzzle game (ROADMAP Batch 10 item 1). The row is otherwise a '
    'normal game; grading into daily_results happens at its terminal transition.';

create index games_daily_puzzle_idx on public.games (daily_puzzle_id)
    where daily_puzzle_id is not null;

-- The one graded attempt per player per puzzle. Written exactly once, by whichever
-- terminal transition (full clear / timeout / give-up) fires first for that player's
-- first daily game of the day — `insert ... on conflict (puzzle_id, player_id) do
-- nothing` makes "first attempt only, replayable for fun" fall out for free.
create table public.daily_results (
    id          bigint generated always as identity primary key,
    puzzle_id   bigint      not null references public.daily_puzzles (id) on delete cascade,
    player_id   uuid        not null references public.players (id) on delete cascade,
    game_id     uuid        not null references public.games (id) on delete cascade,
    completed   boolean     not null,
    final_score int         not null,
    graded_at   timestamptz not null default now(),
    unique (puzzle_id, player_id)
);

comment on table public.daily_results is
    'One row per (daily puzzle, player): the first graded attempt. completed = the target '
    'word was found. final_score is frozen here at grade time (also lives on the games '
    'row) so the streak / leaderboard queries never join back to games or game_guesses.';

-- Daily leaderboard: top scores for one puzzle.
create index daily_results_leaderboard_idx on public.daily_results (puzzle_id, final_score desc);

-- Streak scan: a player's completed days, newest first.
create index daily_results_player_idx on public.daily_results (player_id) where completed;
