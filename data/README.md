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

- **Provenance unknown, licence unverified.** This file predates ROADMAP.md (present
  since the original Streamlit prototype) and Batch 0.9 already flagged "confirm and
  document the source and licence" as an open TODO — checked again for this batch
  (git history, README, and repo-wide search for any accompanying note) and still found
  nothing establishing where the 161k-word list came from or under what terms. Do not
  assert a licence for this file without a source to point at. If the original author can
  identify the source, update this section; until then, treat it as a legacy asset carried
  forward, not one with confirmed redistribution rights.
