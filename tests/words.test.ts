/**
 * Unit tests for the board/word rules. No database, no network — these pin the letter
 * semantics the whole game rests on.
 */
import { describe, expect, it } from "vitest";
import {
  canFormWord,
  durationForLength,
  letterClearFraction,
  letterCount,
  normalizeWord,
  scoreFor,
  scrambleWord,
  signatureOf,
  subSignatures,
} from "../lib/words.js";

describe("canFormWord — accents and double letters", () => {
  // Ported from backend/tests/test_api.py::test_can_form_word_accents_and_doubles.
  it("allows an accented letter the board actually has", () => {
    expect(canFormWord("KÖR", "KÖRÖM")).toBe(true);
  });

  it("allows an exact multiset", () => {
    expect(canFormWord("ALMA", "ALMA")).toBe(true);
  });

  it("respects letter counts", () => {
    expect(canFormWord("AA", "A")).toBe(false);
  });

  it("counts accents distinctly, order-independently", () => {
    expect(canFormWord("ÁÉ", "ÉÁ")).toBe(true);
  });

  it("does not treat an accented letter as its bare form", () => {
    expect(canFormWord("Ő", "O")).toBe(false);
  });

  it("does not treat a digraph as one letter (ROADMAP 6.3)", () => {
    // SZ is two letters, so a board with a single S cannot spell it.
    expect(canFormWord("SZ", "SZO")).toBe(true);
    expect(canFormWord("SZSZ", "SZO")).toBe(false);
  });
});

describe("signatureOf", () => {
  it("is order-independent", () => {
    expect(signatureOf("ALMA")).toBe(signatureOf("LAMA"));
  });

  it("keeps duplicate letters", () => {
    expect(signatureOf("ALMA")).toBe("AALM");
  });

  it("sorts accented letters by code point, not by base letter", () => {
    expect(signatureOf("ÖK")).toBe("KÖ");
  });
});

describe("subSignatures", () => {
  it("produces one signature per distinct sub-multiset, not per permutation", () => {
    // 3 distinct letters, min length 1 -> 2^3 - 1 = 7 non-empty subsets.
    expect(new Set(subSignatures("ABC", 1)).size).toBe(7);
  });

  it("collapses repeated letters instead of double-counting them", () => {
    // AAB: sub-multisets of length >= 1 are A, AA, B, AB, AAB -> 5.
    expect(subSignatures("AAB", 1).sort()).toEqual(["A", "AA", "AAB", "AB", "B"]);
  });

  it("yields the ~100 combinations the design assumed for a 7-letter board", () => {
    // The whole point of the signature index: 99 lookups, not a 155k-row scan.
    expect(subSignatures(signatureOf("HANGKÖZ"), 3)).toHaveLength(99);
  });

  it("stays small even for the longest allowed board", () => {
    expect(subSignatures(signatureOf("HALLÓSZERV"), 3).length).toBeLessThan(1000);
  });

  it("contains exactly the signatures of the words the board can form", () => {
    const board = signatureOf("ALMA");
    const signatures = new Set(subSignatures(board, 3));
    expect(signatures.has(signatureOf("ALMA"))).toBe(true);
    expect(signatures.has(signatureOf("LAM"))).toBe(true);
    expect(signatures.has(signatureOf("MAMA"))).toBe(false); // needs two M
  });
});

describe("scoring and normalisation", () => {
  it("scores the square of the letter count", () => {
    expect(scoreFor("ALMA")).toBe(16);
  });

  it("counts an accented letter once, not as two UTF-16 units", () => {
    expect(letterCount("HATTYÚ")).toBe(6);
    expect(scoreFor("HATTYÚ")).toBe(36);
  });

  it("uppercases and trims, and rejects out-of-range words", () => {
    expect(normalizeWord("  alma \n")).toBe("ALMA");
    expect(normalizeWord("ab")).toBeNull();
    expect(normalizeWord("")).toBeNull();
  });

  it("rejects words containing anything but letters (ROADMAP 1.1 bugfix)", () => {
    expect(normalizeWord("adó-vevő")).toBeNull(); // hyphenated compound
    expect(normalizeWord("bimbós kel")).toBeNull(); // multi-word phrase
    expect(normalizeWord("wtf!")).toBeNull(); // punctuation
    expect(normalizeWord("alma2")).toBeNull(); // digit
  });

  it("still accepts a loanword letter outside any one wordlist's core alphabet", () => {
    expect(normalizeWord("doppelgänger")).toBe("DOPPELGÄNGER");
  });
});

describe("scrambleWord", () => {
  it("keeps the same letters and shows them space-separated", () => {
    const scrambled = scrambleWord("HANGKÖZ");
    expect(scrambled.split(" ").join("")).toHaveLength(7);
    expect(signatureOf(scrambled.split(" ").join(""))).toBe(signatureOf("HANGKÖZ"));
  });
});

describe("letterClearFraction (ROADMAP Batch 10 item 3's KNOWN CORRECTION fix)", () => {
  it("is the found letters over the total possible letters, not a word-count ratio", () => {
    // Finding only the 7-letter word out of {3, 7} is "1 of 2" by word count (50%) but
    // 7 of 10 total letters (70%) — the function must report the latter.
    expect(letterClearFraction(["AAA", "BBBBBBB"], ["BBBBBBB"])).toBe(0.7);
  });

  it("is 1 for a full clear", () => {
    expect(letterClearFraction(["ALMA", "BOR"], ["ALMA", "BOR"])).toBe(1);
  });

  it("is 0 when nothing was found", () => {
    expect(letterClearFraction(["ALMA", "BOR"], [])).toBe(0);
  });

  it("weighs a missed long word more than a missed short one", () => {
    // Missing the 3-letter word out of {3,3,3,10} hurts less than missing the 10-letter one.
    const board = ["ABC", "DEF", "GHI", "JKLMNOPQRS"];
    const missShort = letterClearFraction(board, ["DEF", "GHI", "JKLMNOPQRS"]);
    const missLong = letterClearFraction(board, ["ABC", "DEF", "GHI"]);
    expect(missShort).toBeGreaterThan(missLong);
  });

  it("does not divide by zero for an empty board", () => {
    expect(letterClearFraction([], [])).toBe(0);
  });
});

describe("durationForLength (ROADMAP 2.3)", () => {
  it("matches the roadmap's formula at both ends of the range", () => {
    expect(durationForLength(5)).toBe(120);
    expect(durationForLength(10)).toBe(195);
  });

  it("is 150s at the default length of 7", () => {
    expect(durationForLength(7)).toBe(150);
  });

  it("increases by 15s per extra letter", () => {
    expect(durationForLength(8) - durationForLength(7)).toBe(15);
  });
});
