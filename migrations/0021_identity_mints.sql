-- Betűvető — identity-mint throttle (ROADMAP 12.6)
--
-- Player identity is a free anonymous cookie: every request without one mints a new
-- players row. This table lets the API cap how many fresh identities one network address
-- can mint per hour, so a script can't bloat the free-tier database or farm identities.
--
-- Privacy: no raw IP address is stored. `ip_hash` is an HMAC of the address keyed with the
-- server's ANON_SESSION_SECRET (lib/identity-throttle.ts), so the table can't be reversed
-- into addresses without that secret. Rows are purged after 24 hours by the same code
-- path that writes them. Not linked to any player row.
--
-- Purely additive. The code fails open if this table doesn't exist yet, so merging the
-- PR before applying this migration can't break game start.

create table public.identity_mints (
    id         bigint generated always as identity primary key,
    ip_hash    text        not null,
    created_at timestamptz not null default now()
);

create index identity_mints_ip_created_idx on public.identity_mints (ip_hash, created_at);
create index identity_mints_created_idx on public.identity_mints (created_at);

comment on table public.identity_mints is
    'One row per freshly minted anonymous identity, keyed by an HMAC of the client IP '
    '(never the raw IP). Rows older than 24 h are purged on write. ROADMAP 12.6.';
