-- Betűvető — Google sign-in account merge (ROADMAP Batch 8.1)
--
-- merge_players(from_id, into_id) folds one player into another and deletes the source.
-- Used when a device that already has its own anonymous player signs in with a Google
-- account that is linked to a DIFFERENT player (e.g. a new phone where someone played a
-- few games before tapping "Keep my progress"). Both histories are kept.
--
-- Why a database function rather than TypeScript: the whole merge must be one atomic
-- step (a half-merged player is worse than either original), and as one function it can
-- be tested against a real Postgres in-process (PGlite, tests/merge-players.test.ts)
-- without needing a deployed database.
--
-- Per table — the rule follows each table's own uniqueness:
--   games, word_suggestions, feedback, admin_audit_log, rooms.host_player_id
--                        → no per-player uniqueness: simply re-pointed
--   word_stats           → summed per (wordlist, word); the game-number markers take the
--                          larger value
--   player_achievements  → union; the earlier unlock time wins
--   daily_results, word_reports, room_players
--                        → re-pointed unless the target already has that puzzle/word/room,
--                          in which case the target's row wins (the source row cascades)
--   players              → the target keeps its own settings; only a missing display
--                          name is taken from the source
--
-- Purely additive; applied the same way as 0001-0027 (npm run db:migrate).

create or replace function public.merge_players(from_id uuid, into_id uuid)
returns void
language plpgsql
as $$
begin
    if from_id = into_id then
        return;
    end if;
    -- Lock both rows so two concurrent sign-ins can't interleave a merge.
    perform 1 from public.players where id in (from_id, into_id) for update;

    insert into public.word_stats as t
        (player_id, wordlist_id, word, times_failed, times_solved,
         last_failed_game_seq, mastered_at_game_number)
    select into_id, wordlist_id, word, times_failed, times_solved,
           last_failed_game_seq, mastered_at_game_number
      from public.word_stats
     where player_id = from_id
    on conflict (player_id, wordlist_id, word) do update
       set times_failed = t.times_failed + excluded.times_failed,
           times_solved = t.times_solved + excluded.times_solved,
           last_failed_game_seq = greatest(t.last_failed_game_seq, excluded.last_failed_game_seq),
           mastered_at_game_number = greatest(t.mastered_at_game_number, excluded.mastered_at_game_number);

    insert into public.player_achievements as t (player_id, achievement_key, unlocked_at)
    select into_id, achievement_key, unlocked_at
      from public.player_achievements
     where player_id = from_id
    on conflict (player_id, achievement_key) do update
       set unlocked_at = least(t.unlocked_at, excluded.unlocked_at);

    update public.daily_results d set player_id = into_id
     where d.player_id = from_id
       and not exists (select 1 from public.daily_results x
                        where x.player_id = into_id and x.puzzle_id = d.puzzle_id);

    update public.word_reports r set player_id = into_id
     where r.player_id = from_id
       and not exists (select 1 from public.word_reports x
                        where x.player_id = into_id and x.word_id = r.word_id);

    update public.room_players r set player_id = into_id
     where r.player_id = from_id
       and not exists (select 1 from public.room_players x
                        where x.player_id = into_id and x.room_id = r.room_id);

    update public.games            set player_id = into_id      where player_id = from_id;
    update public.word_suggestions set player_id = into_id      where player_id = from_id;
    update public.feedback         set player_id = into_id      where player_id = from_id;
    update public.admin_audit_log  set admin_id = into_id       where admin_id = from_id;
    update public.rooms            set host_player_id = into_id where host_player_id = from_id;

    update public.players p
       set display_name = coalesce(p.display_name, f.display_name)
      from public.players f
     where p.id = into_id and f.id = from_id;

    -- Whatever is left on the source (conflicting duplicates) cascades away with it.
    delete from public.players where id = from_id;
end;
$$;

comment on function public.merge_players(uuid, uuid) is
    'ROADMAP 8.1: fold player from_id into into_id (games re-pointed, word_stats summed, '
    'achievements unioned, target wins on per-puzzle/word/room conflicts), then delete from_id.';
