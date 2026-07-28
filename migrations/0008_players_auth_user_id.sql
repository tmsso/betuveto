-- Betűvető — Neon Auth admin login (ROADMAP 5.2 item 2 follow-up, Magic Link design)
--
-- Nullable, unique link from a players row to its Neon Auth (Better Auth) user id.
-- Deliberately generic (not admin_auth_user_id): Batch 8 reuses this same column for
-- every player via Google OAuth identity linking, not just admins. Populated only for
-- admin rows for now, by direct SQL against production after a successful first
-- magic-link sign-in — same manual bootstrap pattern as is_admin (5.1), not a self-service
-- flow. Purely additive, applied the same way as 0001-0007 (npm run db:migrate).

alter table public.players add column auth_user_id text unique;

comment on column public.players.auth_user_id is
    'Neon Auth (Better Auth) user id, once linked. Null for anonymous/unlinked players. Populated manually for admins until Batch 8 links it via Google OAuth for everyone.';
