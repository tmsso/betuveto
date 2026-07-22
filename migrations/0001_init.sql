-- Betűvető — initial schema (ROADMAP Batch 1 / 1.5)
--
-- Target architecture: Vercel serverless functions + Neon Postgres. This is the
-- from-scratch build for Neon; it consolidates the two Supabase-era migrations and
-- removes their Supabase-specific bits:
--   * players.id no longer references Supabase's `auth.users` — it is a standalone UUID.
--     Batch 2 links it to the Neon Auth user id (or a signed anonymous cookie).
--   * No Row Level Security. Under Supabase, RLS deny-all mattered because the anon key
--     could reach the database directly. On Neon the client never receives DB credentials
--     at all — every query runs in a Vercel function holding DATABASE_URL — so RLS is not
--     the security boundary here (it is optional hardening; see ROADMAP decision 3).
--
-- Word matching is letter-by-letter by design (Hungarian digraphs cs/sz/... are NOT
-- special-cased — see ROADMAP decision 6.3). A word's `signature` is its letters,
-- NFC-normalised, uppercased, then sorted by code point. The findable words for a board
-- are exactly those whose signature is a multiset-subset of the board's letters, which the
-- API enumerates as ~100 signature combinations instead of scanning the whole wordlist.

-- ---------------------------------------------------------------------------
-- players — one row per identity (anonymous-first; see Batch 2). `id` is a standalone
-- UUID for now; Batch 2 links it to the Neon Auth user id.
-- ---------------------------------------------------------------------------
create table public.players (
    id               uuid primary key default gen_random_uuid(),
    created_at       timestamptz not null default now(),
    display_name     text,
    is_admin         boolean     not null default false,
    preferred_length integer     check (preferred_length is null
                                         or (preferred_length between 5 and 10))
);

comment on table public.players is
    'Game players. id is a standalone UUID until Batch 2 links it to the Neon Auth user id. display_name/preferred_length are optional.';

-- ---------------------------------------------------------------------------
-- wordlists — one row per language/dictionary (Batch 6 adds `en`).
-- ---------------------------------------------------------------------------
create table public.wordlists (
    id         bigint generated always as identity primary key,
    code       text        not null unique,   -- e.g. 'hu'
    name       text        not null,
    active     boolean     not null default true,
    created_at timestamptz not null default now()
);

comment on table public.wordlists is
    'Dictionaries/languages. `code` is the stable key (hu, en, ...).';

-- ---------------------------------------------------------------------------
-- words — the dictionary. `signature` = sorted letters (NFC+uppercase), indexed
-- for the signature-subset possible-words query. `source` distinguishes the
-- imported list from later user suggestions (Batch 4); `active` lets curation
-- (Batch 4/5) retire words without deleting history.
-- ---------------------------------------------------------------------------
create table public.words (
    id          bigint generated always as identity primary key,
    wordlist_id bigint      not null references public.wordlists (id) on delete cascade,
    word        text        not null,
    length      integer     not null check (length > 0),
    signature   text        not null,
    active      boolean     not null default true,
    source      text        not null default 'original'
                    check (source in ('original', 'suggested')),
    created_at  timestamptz not null default now(),
    unique (wordlist_id, word)
);

comment on column public.words.signature is
    'Letters of `word`, NFC-normalised, uppercased, sorted by code point. Used for the multiset-subset possible-words lookup.';

-- Signature lookup for possible-words (WHERE wordlist_id = ? AND signature = any(...)).
create index words_wordlist_signature_idx
    on public.words (wordlist_id, signature)
    where active;

-- Target-word selection by board length among active words.
create index words_wordlist_length_active_idx
    on public.words (wordlist_id, length, active);

-- ---------------------------------------------------------------------------
-- games — server-authoritative game state (replaces the in-process dict). The
-- target word and possible-word list never leave the server while active.
-- ---------------------------------------------------------------------------
create table public.games (
    id                uuid primary key default gen_random_uuid(),
    player_id         uuid        references public.players (id) on delete set null,
    wordlist_id       bigint      not null references public.wordlists (id),
    target_word       text        not null,
    scrambled_letters text        not null,
    target_length     integer     not null check (target_length between 5 and 10),
    started_at        timestamptz not null default now(),
    ends_at           timestamptz not null,
    ended_at          timestamptz,
    final_score       integer,
    found_count       integer     not null default 0,
    possible_count    integer     not null default 0,
    status            text        not null default 'active'
                          check (status in ('active', 'finished', 'given_up',
                                            'abandoned', 'expired'))
);

comment on table public.games is
    'One row per game. player_id is nullable (anonymous). status ''expired'' = the server timer ran out (ROADMAP 0.4); ''abandoned'' = swept without a terminal action.';
comment on column public.games.scrambled_letters is
    'The board as shown to the player: the target word''s letters, shuffled, space-separated. Mutated by rescramble; not derivable from target_word.';

create index games_player_idx on public.games (player_id);
-- Leaderboard reads (Batch 2): finished games by wordlist+length, best first.
create index games_leaderboard_idx
    on public.games (wordlist_id, target_length, final_score desc)
    where status = 'finished';

-- ---------------------------------------------------------------------------
-- game_guesses — every scored guess, for anti-cheat / "words found" history
-- (Batch 2/3) and review (Batch 5).
-- ---------------------------------------------------------------------------
create table public.game_guesses (
    id         bigint generated always as identity primary key,
    game_id    uuid        not null references public.games (id) on delete cascade,
    word       text        not null,
    correct    boolean     not null,
    score      integer     not null default 0,
    created_at timestamptz not null default now()
);

create index game_guesses_game_idx on public.game_guesses (game_id);

-- A correct guess must be unique per game: the API dedupes by inserting first and
-- treating a conflict as "already guessed", which is only race-free if the database
-- enforces it. Without this, a double-submitted word could score twice.
create unique index game_guesses_game_word_correct_uidx
    on public.game_guesses (game_id, word)
    where correct;

-- ---------------------------------------------------------------------------
-- word_stats — per-player failed/solved counts, replacing the in-memory
-- `failed_words` dict that drives the spaced-repetition reappearance system.
-- ---------------------------------------------------------------------------
create table public.word_stats (
    player_id            uuid    not null references public.players (id) on delete cascade,
    word                 text    not null,
    times_failed         integer not null default 0,
    times_solved         integer not null default 0,
    last_failed_game_seq integer,
    primary key (player_id, word)
);

comment on table public.word_stats is
    'Per-player word history feeding the failed-word reappearance weighting (ROADMAP Batch 1/10).';
