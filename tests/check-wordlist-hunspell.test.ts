import { describe, expect, it } from "vitest";
import {
  checkForm,
  firstSplit,
  gameWords,
  reviewRows,
  splitsOf,
  toTsv,
} from "../scripts/check-wordlist-hunspell.js";

describe("check-wordlist-hunspell (ROADMAP 16.9 Step 1)", () => {
  it("normalises like the importer: uppercase, de-duplicated, non-letters and short words dropped", () => {
    expect(gameWords("alma\nAlma\nCelsius-fok\nab\nDabas\n\nkörte\n")).toEqual(["ALMA", "DABAS", "KÖRTE"]);
  });

  it("checks the lowercase form, so a proper noun can't pass as a common word", () => {
    expect(checkForm("DABAS")).toBe("dabas");
    expect(checkForm("ŐSZI")).toBe("őszi");
  });

  it("cuts only into parts of at least 3 letters, counting code points not bytes", () => {
    expect(splitsOf("kézírat")).toEqual([
      ["kéz", "írat"],
      ["kézí", "rat"],
    ]);
    expect(splitsOf("alma")).toEqual([]);
  });

  it("finds the first split whose both parts are accepted", () => {
    const ok = new Set(["kéz", "írat", "rat"]);
    expect(firstSplit("kézírat", (p) => ok.has(p))).toBe("kéz+írat");
    expect(firstSplit("kézírat", () => false)).toBeNull();
  });

  it("keeps only rejected words, with length, zipf and split", () => {
    const rows = reviewRows(
      ["ALMA", "THOMAS", "KÉZÍRAT"],
      new Set(["thomas", "kézírat"]),
      new Map([["THOMAS", 4.66]]),
      (p) => ["kéz", "írat"].includes(p),
    );
    expect(rows).toEqual([
      { word: "THOMAS", length: 6, zipf: 4.66, split: null },
      { word: "KÉZÍRAT", length: 7, zipf: null, split: "kéz+írat" },
    ]);
    expect(toTsv(rows)).toBe("word\tlength\tzipf\tsplit\nTHOMAS\t6\t4.66\t\nKÉZÍRAT\t7\t\tkéz+írat\n");
  });
});
