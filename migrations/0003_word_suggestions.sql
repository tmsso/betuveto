-- Betűvető — suggest a missing word (ROADMAP Batch 4.2)
--
-- Purely additive: no existing column or row is touched. Applied the same way as 0001/
-- 0002 (npm run db:migrate), tracked in schema_migrations.

-- word_suggestions — a player-submitted word not yet in the dictionary. The word itself
-- lands in `words` immediately (active=false, source='suggested', ROADMAP 4.2) so the
-- signature/length machinery and Batch 5's review queue both just work; this table is
-- the audit trail of who suggested it and when, and the per-player rate-limit basis.
create table public.word_suggestions (
    id         bigint generated always as identity primary key,
    word_id    bigint      not null references public.words (id) on delete cascade,
    player_id  uuid        not null references public.players (id) on delete cascade,
    status     text        not null default 'open'
                    check (status in ('open', 'accepted', 'rejected')),
    created_at timestamptz not null default now()
);

comment on table public.word_suggestions is
    'Player-submitted words not yet in the dictionary. The word row itself (active=false, source=''suggested'') lives in `words`; admin review (Batch 5) accepting a suggestion flips that row''s active to true.';

-- Drives both the review queue (open suggestions) and the 10/player/day rate limit
-- (count this player's rows created in the last 24h).
create index word_suggestions_player_created_idx on public.word_suggestions (player_id, created_at);
