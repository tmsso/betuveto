-- Betűvető — UI language preference (ROADMAP Batch 6.2)
--
-- Distinct from a game's wordlist (which dictionary the target word is drawn from,
-- ROADMAP 6.1/migrations/0009): this is which language the interface text itself renders
-- in. A player could in principle play the English wordlist with a Hungarian UI or vice
-- versa — the two preferences are independent, same as the roadmap treats them as two
-- separate batch items.

alter table public.players
    add column preferred_language text check (preferred_language in ('hu', 'en'));

comment on column public.players.preferred_language is
    'UI language (react-i18next catalog to load), independent of any game''s wordlist. Null = not set, frontend falls back to browser auto-detect.';
