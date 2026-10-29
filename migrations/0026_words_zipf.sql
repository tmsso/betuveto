-- Betűvető — corpus word frequency (ROADMAP 11.21)
--
-- One additive nullable column, safe to apply BEFORE the code that reads it ships. Filled by
-- `npm run db:frequency` from data/frequency-<code>.tsv (derived from `wordfreq`, CC BY-SA
-- 4.0, see data/README.md). Null = the frequency list does not know the word, which for this
-- game means "rare": most of the ~150k Hungarian entries are inflected forms no corpus lists.

alter table public.words add column zipf real;

comment on column public.words.zipf is
    'wordfreq Zipf frequency (about 1 = very rare .. 7 = the/of; 3.5 = an ordinary word). '
    'Null when unranked. Seeds easy mode (lib/word-stats.ts pickEasyWord) and the admin hardest-words view.';

-- Easy mode draws from the common end of one (wordlist, length): this lets that be an index
-- range scan instead of a pass over every word of the length.
create index words_wordlist_length_zipf_idx
    on public.words (wordlist_id, length, zipf)
    where zipf is not null and active;
