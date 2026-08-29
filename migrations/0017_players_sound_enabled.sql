-- Betűvető — sound-effects preference (ROADMAP Batch 10 item 8)
--
-- Same per-player-preference shape as preferred_language / preferred_theme: a nullable
-- setting read/written through api/v1/me/preferences with the anon-cookie identity.
-- Nullable with null meaning "off": the effects default to silent (browsers block audio
-- before a user gesture anyway, and unprompted sound is a poor surprise), and the header
-- toggle flips it to true.

alter table public.players
    add column sound_enabled boolean;

comment on column public.players.sound_enabled is
    'Whether the synthesised sound effects (ROADMAP Batch 10 item 8) play for this '
    'player. Null = never set; the frontend treats that as off.';
