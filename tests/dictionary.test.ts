import { describe, expect, it } from "vitest";
import { definitionUrl } from "../frontend/src/dictionary.js";

describe("definitionUrl", () => {
  it("uses the Hungarian Wiktionary for Hungarian boards, lowercased and with accents encoded", () => {
    // The game stores words uppercase (see lib/words.ts), but Wiktionary entries are
    // lowercase; confirmed live that the uppercase form 404s and this one 200s.
    expect(definitionUrl("HATTYÚ", "hu")).toBe(
      "https://hu.wiktionary.org/wiki/hatty%C3%BA",
    );
  });

  it("uses the English Wiktionary independently of the UI language", () => {
    expect(definitionUrl("WORD", "en")).toBe("https://en.wiktionary.org/wiki/word");
  });

  it("does not make a misleading link for an unknown wordlist", () => {
    expect(definitionUrl("WORD", "de")).toBeNull();
  });
});
