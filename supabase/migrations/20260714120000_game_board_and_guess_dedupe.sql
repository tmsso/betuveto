-- Betűvető — server-authoritative game state (ROADMAP Batch 1.2)
--
-- Two gaps the initial schema left, both only visible once the API stopped keeping games
-- in process memory:
--
-- 1. The scrambled board has to be stored. It is not derivable from the target word —
--    it is a random shuffle, and `rescramble` deliberately changes it — so a client
--    polling /game/{id} after a redeploy must read back the same board it is looking at.
--
-- 2. A correct guess must be unique per game. The API dedupes by inserting first and
--    treating a conflict as "already guessed", which is only race-free if the database
--    enforces it: without this index, a double-submitted word could score twice.

alter table public.games
    add column scrambled_letters text not null default '';

-- The default exists only to satisfy the NOT NULL for any in-flight rows; every game is
-- inserted with its board, so no row should ever rely on it.
alter table public.games
    alter column scrambled_letters drop default;

comment on column public.games.scrambled_letters is
    'The board as shown to the player: the target word''s letters, shuffled, space-separated. Mutated by rescramble.';

create unique index game_guesses_game_word_correct_uidx
    on public.game_guesses (game_id, word)
    where correct;
