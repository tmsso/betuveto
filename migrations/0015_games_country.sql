-- ROADMAP Batch 10 item 13: country-level geolocation for the admin dashboard's player
-- stat drill-down. Deliberately country-only, not city/precise-coordinate (Vercel's
-- x-vercel-ip-country request header, no GeoIP service needed) — nothing here needs finer
-- granularity, and anything more precise is PII-adjacent with no clear use.
alter table public.games
    add column country text;

comment on column public.games.country is
    'Two-letter ISO country code from the request''s x-vercel-ip-country header at game '
    'start, or null (local dev, or the header absent for any other reason). Admin-only '
    'aggregate use (ROADMAP Batch 10 item 13) — never exposed to the player.';
