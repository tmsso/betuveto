-- Betűvető — in-app tester feedback (ROADMAP 12.7)
--
-- Replaces 12.5's pre-filled mailto link: a mailto must publish the receiving address in
-- the served bundle, and the owner chose not to publish one. Players write a short
-- message in the help dialog instead, and the admin reads it on the dashboard.
--
-- Privacy: the message plus the context the old mailto body carried (page URL, browser
-- user agent, UI language). No IP. Rows cascade with the player, so DELETE /api/v1/me
-- removes a player's feedback with everything else (disclosed on the privacy page).
--
-- Purely additive. Old code never reads it; the new code answers 503 without it, so
-- running this before merging the PR leaves no window where the route is broken.

create table public.feedback (
    id          bigint generated always as identity primary key,
    player_id   uuid        not null references public.players (id) on delete cascade,
    message     text        not null check (char_length(message) between 1 and 2000),
    page_url    text,
    user_agent  text,
    ui_language text,
    created_at  timestamptz not null default now(),
    resolved_at timestamptz
);

create index feedback_created_idx on public.feedback (created_at desc);
create index feedback_player_created_idx on public.feedback (player_id, created_at);

comment on table public.feedback is
    'Tester feedback from the in-app form (ROADMAP 12.7). resolved_at set by an admin. '
    'Cascades with the player (account deletion).';
