/** ROADMAP 13.6 — the "select suspicious" heuristics. Pure, no database. */
import { describe, expect, it } from "vitest";
import { suspicionReasons, tokenize } from "../lib/suspicious-words.js";

const HU_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÖŐÚÜŰ";
const EN_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const hu = (w: string) => suspicionReasons(w, "hu", HU_ALPHABET);
// The owner's original thresholds (3+ vowels, 4+ consonants), to test the run logic itself.
const STRICT = { minLength: 3, maxVowelRun: 2, maxConsonantRun: 3 };
const huStrict = (w: string) => suspicionReasons(w, "hu", HU_ALPHABET, STRICT);

describe("tokenize (hu)", () => {
  it("treats digraphs and the trigraph as one consonant, longest first", () => {
    expect(tokenize("ORSZÁG").map((t) => t.text)).toEqual(["O", "R", "SZ", "Á", "G"]);
    expect(tokenize("BRIDZS").map((t) => t.text)).toEqual(["B", "R", "I", "DZS"]);
    expect(tokenize("EDZŐ").map((t) => t.text)).toEqual(["E", "DZ", "Ő"]);
  });

  it("merges a doubled (long) consonant into one token", () => {
    expect(tokenize("LEGSZEBB").map((t) => t.text)).toEqual(["L", "E", "G", "SZ", "E", "BB"]);
    expect(tokenize("ASSZONY").map((t) => t.text)).toEqual(["A", "SSZ", "O", "NY"]);
    expect(tokenize("EGGYEL").map((t) => t.text)).toEqual(["E", "GGY", "E", "L"]);
  });
});

describe("suspicionReasons (hu)", () => {
  it("leaves real words with consonant clusters alone", () => {
    for (const word of ["LEGSZEBB", "ORSZÁG", "HANGSZER", "SPORTCSARNOK", "KERTKAPU", "ASSZONY", "HEGY"]) {
      expect(hu(word), word).toEqual([]);
    }
  });

  it("flags vowel-only and consonant-only words", () => {
    expect(hu("AEIOU")).toContain("vowels_only");
    expect(hu("BRKT")).toContain("consonants_only");
    // A lone digraph is still consonants only.
    expect(hu("SZSZSZ")).toContain("consonants_only");
  });

  it("flags foreign letters, but not Y inside a digraph", () => {
    expect(hu("WHISKY")).toContain("foreign_letter");
    expect(hu("TAXI")).toContain("foreign_letter");
    expect(hu("QUARK")).toContain("foreign_letter");
    expect(hu("NAGYON")).not.toContain("foreign_letter");
    expect(hu("SÄNGER")).toContain("foreign_letter"); // outside the wordlist alphabet
  });

  it("flags long vowel and consonant runs (strict thresholds)", () => {
    expect(huStrict("BAEIK")).toContain("vowel_run");
    expect(huStrict("KAKAÓ")).not.toContain("vowel_run");
    // Real words can have three vowels in a row (possessives, -ért after a long vowel):
    // why the default was raised to 4+ (D-13a).
    expect(huStrict("KAKAÓÉRT")).toContain("vowel_run");
    expect(huStrict("ABRTKA")).toContain("consonant_run");
    expect(huStrict("ABRTA")).not.toContain("consonant_run");
  });

  it("uses 4+ vowels / 5+ consonants by default (D-13a)", () => {
    for (const word of ["KAKAÓÉRT", "ABSZTRAKT", "ENERGIAELLÁTÁS", "SPORTCSARNOK"]) {
      expect(hu(word), word).toEqual([]);
    }
    expect(hu("BAEIOK")).toContain("vowel_run");
    expect(hu("ABRTKLA")).toContain("consonant_run");
  });

  it("takes the thresholds as parameters", () => {
    expect(suspicionReasons("ABRTA", "hu", HU_ALPHABET, { minLength: 3, maxVowelRun: 2, maxConsonantRun: 2 }))
      .toContain("consonant_run");
    expect(suspicionReasons("ALMA", "hu", HU_ALPHABET, { minLength: 5, maxVowelRun: 2, maxConsonantRun: 3 }))
      .toEqual(["too_short"]);
  });
});

describe("suspicionReasons (en)", () => {
  it("treats Y as a vowel and has no digraphs", () => {
    expect(suspicionReasons("RHYTHM", "en", EN_ALPHABET)).toEqual([]);
    expect(suspicionReasons("BCDFG", "en", EN_ALPHABET)).toContain("consonants_only");
  });
});
