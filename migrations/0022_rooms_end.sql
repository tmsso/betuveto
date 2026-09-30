-- Betűvető — how a room ended (ROADMAP 7.2.3 / 7.2.4)
--
-- The end-of-game reveal reports whether a co-op room cleared the board together and what
-- equal share of the time bonus each member still playing received (owner decision D2).
-- Neither is derivable afterwards (the multiplier is admin-editable, and "members still
-- playing at that moment" isn't recorded anywhere else), so finishRoom() stores both.
--
-- Purely additive; both columns stay null until a room finishes.

alter table public.rooms
    add column end_reason       text check (end_reason in ('cleared', 'all_done', 'expired')),
    add column bonus_per_member int;

comment on column public.rooms.end_reason is
    'Why a finished room ended: cleared (co-op collective clear), all_done (every member game '
    'terminal), expired (shared deadline). Null until finished. lib/room-lifecycle.ts.';
comment on column public.rooms.bonus_per_member is
    'Co-op collective-clear bonus paid to each member still playing (D2). 0 otherwise.';
