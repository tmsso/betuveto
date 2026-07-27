-- Betűvető — admin audit log (ROADMAP Batch 5.2)
--
-- Purely additive. Applied the same way as 0001-0003 (npm run db:migrate).

-- admin_audit_log — one row per admin mutation (accept/reject a report or suggestion,
-- reactivate a word, and future 5.2 mutations). admin_id is nullable and unpopulated for
-- now: the interim ADMIN_TOKEN auth (5.1) has no per-admin player identity to attribute
-- an action to — everyone using the shared token looks the same. It becomes meaningful
-- once Batch 8's Google OAuth gives admins a real logged-in identity to record here;
-- until then, *what* changed and *when* still matters even without *who*.
create table public.admin_audit_log (
    id         bigint generated always as identity primary key,
    admin_id   uuid        references public.players (id) on delete set null,
    action     text        not null,
    payload    jsonb,
    created_at timestamptz not null default now()
);

comment on table public.admin_audit_log is
    'One row per admin mutation. admin_id is null until Batch 8 gives admins a real per-player identity to attribute actions to.';

create index admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
