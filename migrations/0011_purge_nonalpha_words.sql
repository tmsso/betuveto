-- Betűvető — purge non-alpha words imported before the ROADMAP 1.1 bugfix
--
-- lib/words.ts's normalizeWord() only ever checked length, never content, so hyphenated
-- compounds and multi-word phrases in the Hungarian source dictionary ("ADÓ-VEVŐ",
-- "BIMBÓS KEL") were imported as ordinary active words — 2,882 of them, spread across
-- every playable board length. Any one of these could be picked as a game's target,
-- scrambling a hyphen/space onto the board that the on-screen keyboard (built from
-- wordlists.alphabet) has no key for — an unplayable, unsolvable puzzle.
--
-- [:alpha:] (not a hand-picked language charset) so a genuine loanword letter outside any
-- one wordlist's core alphabet (e.g. "DOPPELGÄNGER"'s Ä) is correctly left alone — this
-- matches lib/words.ts's new \p{L}-based normalizeWord() check exactly.
--
-- word_reports/word_suggestions both reference words.id with on delete cascade
-- (migrations/0002, 0003), so any stray report/suggestion against one of these rows is
-- harmlessly removed too. games/game_guesses/word_stats store words as text snapshots,
-- not foreign keys, so this never touches historical game data.

delete from public.words where word ~ '[^[:alpha:]]';
