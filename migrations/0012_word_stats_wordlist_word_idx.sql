-- ROADMAP Batch 10 item 2 (difficulty rating per word): both the admin dashboard's
-- hardest-words view and game/start's easy-mode target selection aggregate word_stats
-- grouped by (wordlist_id, word) across every player. The table's primary key leads with
-- player_id (migrations/0009), which doesn't serve that access pattern. This secondary
-- index matches the group-by so both queries stay index-backed as word_stats grows.
create index word_stats_wordlist_word_idx on public.word_stats (wordlist_id, word);
