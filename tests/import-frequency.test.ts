import { describe, expect, it } from "vitest";
import { parseFrequencyTsv } from "../scripts/import-frequency.js";

describe("parseFrequencyTsv (ROADMAP 11.21)", () => {
  it("uppercases and NFC-normalises words, matching the words table", () => {
    const { rows } = parseFrequencyTsv("alma\t5.10\nőszi\t3.80\n");
    expect(rows).toEqual([
      { word: "ALMA", zipf: 5.1 },
      { word: "ŐSZI", zipf: 3.8 },
    ]);
  });

  it("counts malformed, non-positive and duplicate lines instead of trusting them", () => {
    const { rows, skipped } = parseFrequencyTsv("alma\t5.1\nalma\t4.0\nkörte\tabc\nbarack\t0\nszilva\n\n");
    expect(rows.map((r) => r.word)).toEqual(["ALMA"]);
    expect(skipped).toBe(4);
  });

  it("the committed files parse cleanly", async () => {
    const { readFile } = await import("node:fs/promises");
    for (const code of ["hu", "en"]) {
      const { rows, skipped } = parseFrequencyTsv(await readFile(`data/frequency-${code}.tsv`, "utf-8"));
      expect(rows.length).toBeGreaterThan(10_000);
      expect(skipped).toBe(0);
    }
  });
});
