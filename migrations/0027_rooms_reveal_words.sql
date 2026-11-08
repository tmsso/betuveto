-- Betűvető — room reveal toggle (owner review 2026-11-08)
--
-- Whether a finished room shows the words nobody found. Chosen by the host at creation,
-- default OFF. Additive with a default, so it is safe to apply BEFORE the code that
-- uses it ships (see the deploy-ordering note: apply this, then merge).

alter table public.rooms
    add column reveal_words boolean not null default false;

comment on column public.rooms.reveal_words is
    'Host''s choice at creation: reveal the words nobody found once the room finishes. '
    'Default false (owner review 2026-11-08). Carried over by rematch.';
