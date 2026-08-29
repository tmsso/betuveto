-- Betűvető — colour-theme preference (ROADMAP Batch 10 item 7: dark mode)
--
-- Same shape as preferred_language (migrations/0010): a nullable per-player UI setting,
-- read/written through api/v1/me/preferences with the anon-cookie identity. 'system'
-- follows the OS `prefers-color-scheme`; null means the player has never chosen and is
-- also treated as 'system' by the frontend — storing the explicit choice lets a
-- three-way toggle (light / dark / system) reflect the real persisted state.

alter table public.players
    add column preferred_theme text check (preferred_theme in ('light', 'dark', 'system'));

comment on column public.players.preferred_theme is
    'UI colour theme (ROADMAP Batch 10 item 7). One of light | dark | system. Null = never '
    'set; the frontend falls back to the OS prefers-color-scheme, same as ''system''.';
