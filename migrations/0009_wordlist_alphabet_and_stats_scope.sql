-- Betűvető — wordlist plumbing for a second language (ROADMAP Batch 6.1)
--
-- 1. wordlists.alphabet: the accepted-letters whitelist for that language's on-screen
--    keyboard, replacing App.jsx's hardcoded Hungarian-only whitelist (consumed by 6.2).
--    Backfilled for 'hu' here; the importer sets it for any new wordlist going forward.
--
-- 2. word_stats gains a wordlist_id dimension. It was keyed only on (player_id, word)
--    since Batch 1.1, which was harmless while 'hu' was the only wordlist — but a
--    spelling common to two languages would otherwise merge its failed/solved counts
--    across languages the moment a second wordlist existed (feeding is_previously_failed
--    and the /me/stats failed-words panel with cross-language false positives). Caught
--    while wiring up 'en' here, fixed now rather than shipped broken. Existing rows
--    backfill to 'hu' (the only wordlist before this migration).

alter table public.wordlists add column alphabet text;
update public.wordlists set alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÖŐÚÜŰ' where code = 'hu';
alter table public.wordlists alter column alphabet set not null;

comment on column public.wordlists.alphabet is
    'Accepted on-screen-keyboard letters for this language, e.g. "ABCDEFGHIJKLMNOPQRSTUVWXYZ" for en.';

alter table public.word_stats add column wordlist_id bigint references public.wordlists (id);
update public.word_stats set wordlist_id = (select id from public.wordlists where code = 'hu');
alter table public.word_stats alter column wordlist_id set not null;

alter table public.word_stats drop constraint word_stats_pkey;
alter table public.word_stats add primary key (player_id, wordlist_id, word);
