# Word lists

Flat files are the *import* format only (ROADMAP architecture decision 6): each is loaded
into the `words` table by `scripts/import-wordlist.ts`, which normalises (NFC, uppercase),
filters to 3–15 letters, and computes each word's signature. Neither file is read at
request time.

## `english-words.txt` (wordlist code `en`)

- **Source:** [`word-list`](https://github.com/sindresorhus/word-list) npm package,
  version `4.1.0` (installed 2026-07-29, tarball shasum
  `4eae3ff69b29309e23ec27d2c6a3ebe6dcdf50d0`), copied in as-is (`words.txt` from the
  package). Upstream describes it as derived from
  [atebits/Words](https://github.com/atebits/Words) and built for word-game/dictionary use
  — already lowercase-only, no proper nouns, no diacritics, one-letter words and many
  common profanities pre-filtered.
- **Licence:** MIT. Copyright (c) Sindre Sorhus (https://sindresorhus.com). Full text
  bundled in the npm package's `license` file; reproduced in full below for reference:

  > Permission is hereby granted, free of charge, to any person obtaining a copy of this
  > software and associated documentation files (the "Software"), to deal in the Software
  > without restriction, including without limitation the rights to use, copy, modify,
  > merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
  > permit persons to whom the Software is furnished to do so, subject to the following
  > conditions: The above copyright notice and this permission notice shall be included in
  > all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS",
  > WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
  > WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
  > NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR
  > OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT
  > OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

  MIT is permissive and compatible with this project's own MIT-licensed code (`LICENSE`);
  attribution is kept here and is not required elsewhere since the word list itself isn't
  redistributed as source code.
- **Import:** `DATABASE_URL='...' npm run db:import -- data/english-words.txt --code en --name English`

## `magyar-szavak.txt` (wordlist code `hu`)

- **Source (identified by the project owner, 2026-11-11):** the GitHub gist
  [Konstantinusz/f9517357e46fa827c3736031ac8d01c7](https://gist.github.com/Konstantinusz/f9517357e46fa827c3736031ac8d01c7)
  ("Magyar szavak listája", published 2020-09-22).
- **Licence: none stated.** The gist carries no licence file or notice, and its author has
  not answered a 2024 comment asking what the list was compiled from. With no licence the
  default is "all rights reserved": the file is publicly readable, but nothing grants a right
  to redistribute it. (A bare list of words has thin copyright protection at best, and the
  EU database right needs a substantial investment by an EU maker — so the practical risk is
  low, but it is not *no* risk, and it is not a claim we can make to players. The Terms page
  therefore says "publicly available word collections", not "open-source dictionaries".)
- **Not a fix:** [Blkzer0/Wordlists](https://github.com/Blkzer0/Wordlists) `Hungarian.txt`
  was considered as a replacement and rejected — that repository has no licence either
  (and is a password-cracking collection, last updated 2018).
- **Planned revision (ROADMAP 16.9):** rebuild the list against
  [Magyar Ispell](https://github.com/laszlonemeth/magyarispell) (the hunspell `hu_HU`
  dictionary; tri-licensed GPL 2 / LGPL 2.1 / MPL 1.1). Expand its `.dic`/`.aff` into word
  forms, keep the words that are in both lists, and mark the rest of the current list
  inactive (`words.active = false`, never deleted — game history references them). After that
  the active list is a subset of a freely licensed dictionary and this section can name
  that licence instead.

## `name-blocklist/hu.txt`, `name-blocklist/en.txt` (display-name filter)

- **Source:** [List of Dirty, Naughty, Obscene, and Otherwise Bad Words](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words)
  by Shutterstock and contributors, files `hu` and `en` at commit
  `5faf2ba42d7b1c0977169ec3611df25a3c08eb13` (fetched 2026-10-15), copied in unmodified.
- **Licence:** [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/)
  (CC BY 4.0). This section is the attribution; the files keep that licence, separate
  from the project's MIT code licence.
- **Use:** never read at request time. `npx tsx scripts/build-name-blocklist.ts` compiles
  them into `lib/name-blocklist.generated.ts`; the match rules live in `lib/name-filter.ts`.

## `frequency-hu.tsv`, `frequency-en.tsv` (word frequency for easy mode)

- **What:** one `word<TAB>zipf` line per word that `wordfreq` knows (16,259 of the Hungarian
  list, 102,229 of the English one). Zipf is `wordfreq`'s log scale: about 1 is very rare, 3.5 an
  everyday word, 7 the most common. Words missing from a file are simply unranked (most
  inflected Hungarian forms), which the game treats as "rare".
- **Source:** [`wordfreq`](https://github.com/rspeer/wordfreq) 3.1.1 by Robyn Speer
  (code Apache-2.0), queried with `scripts/build-frequency.py` (`zipf_frequency` for `hu`, the
  "small" list, and `en`). Citation: Robyn Speer. (2022). *rspeer/wordfreq: v3.0 (v3.0.2)*.
  Zenodo. https://doi.org/10.5281/zenodo.7199437
- **Licence:** `wordfreq`'s data files are distributed under
  [Creative Commons Attribution-ShareAlike 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
  (CC BY-SA 4.0). The two TSV files are derived from that data and **keep CC BY-SA 4.0**,
  separate from the project's MIT code licence (accepted by the owner, 2026-10-29). The
  upstream data in turn draws on the Leeds Internet Corpus, Wikipedia, ParaCrawl, OPUS
  OpenSubtitles 2018 (credit: OpenSubtitles), SUBTLEX word lists (Marc Brysbaert et al.) and
  Google Books Ngrams, as listed in `wordfreq`'s own README.
- **Use:** never read at request time. `npm run db:frequency -- --code hu|en` writes the values
  into `words.zipf` (migration 0026); easy mode and the admin hardest-words table read that column.
- **Coverage (checked 2026-10-29):** about 13% of the Hungarian list and 41% of the English list
  is ranked overall, but that includes the words that matter: at Zipf >= 3.5 there are
  roughly 700-1,500 Hungarian and 900-2,000 English candidates per target length 5-10.
