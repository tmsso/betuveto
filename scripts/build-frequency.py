#!/usr/bin/env python3
"""Regenerates data/frequency-<code>.tsv from the `wordfreq` package (ROADMAP 11.21).

Not part of any build or CI step: the TSV files are committed, so nobody needs Python to
run the app or the importer. Re-run only to refresh them:

    python3 -m venv /tmp/wf && /tmp/wf/bin/pip install wordfreq==3.1.1
    /tmp/wf/bin/python scripts/build-frequency.py

Each output line is `word<TAB>zipf`, lower-case NFC, only words wordfreq actually knows
(zipf > 0). Zipf is wordfreq's log scale: about 1 (very rare) to 7+ (the, of); 3.5 is
roughly "an ordinary word a native speaker meets weekly". Licence: the data is CC BY-SA 4.0,
see data/README.md for the attribution this requires.
"""
import unicodedata
from pathlib import Path

from wordfreq import zipf_frequency

ROOT = Path(__file__).resolve().parent.parent
LISTS = {"hu": "magyar-szavak.txt", "en": "english-words.txt"}
MIN_LEN, MAX_LEN = 3, 15  # same bounds scripts/import-wordlist.ts filters to

for code, source in LISTS.items():
    seen = set()
    rows = []
    for line in (ROOT / "data" / source).read_text(encoding="utf-8").splitlines():
        word = unicodedata.normalize("NFC", line.strip().lower())
        if word in seen or not word.isalpha() or not MIN_LEN <= len(word) <= MAX_LEN:
            continue
        seen.add(word)
        zipf = zipf_frequency(word, code)
        if zipf > 0:
            rows.append((word, zipf))
    rows.sort()
    out = ROOT / "data" / f"frequency-{code}.tsv"
    out.write_text("".join(f"{w}\t{z:.2f}\n" for w, z in rows), encoding="utf-8")
    print(f"{code}: {len(rows)} ranked of {len(seen)} -> {out.name}")
