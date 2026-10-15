/**
 * Unit tests for the display-name blocklist (lib/name-filter.ts). No database, no network.
 * The "allowed" cases are the false positives measured while choosing the match rule —
 * each one would be blocked by plain substring matching.
 */
import { describe, expect, it } from "vitest";
import { isDisplayNameAllowed } from "../lib/name-filter.js";

describe("isDisplayNameAllowed — blocks", () => {
  it.each([
    "kurva",
    "Kurvák",            // prefix entry + Hungarian suffix
    "KURVA ANYAD",       // case-insensitive, one bad word is enough
    "k u r v a",         // spaced out → collapsed
    "f.a.s.z",           // dotted short entry → collapsed exact
    "Fasz",
    "kurv4",             // leetspeak
    "B4stard",
    "bastardise",        // forced-prefix entry
    "ass",
  ])("%s", (name) => {
    expect(isDisplayNameAllowed(name)).toBe(false);
  });
});

describe("isDisplayNameAllowed — allows", () => {
  it.each([
    "Kovács Pista",
    "Franciska",         // "franc" is exact-only: it begins "francia"
    "Barométer Bea",     // "barom" exact-only
    "Huszár Gábor",      // contains "szar", not at a word start
    "Lövészárok",
    "Kassai",            // contains "ass"
    "aromatherapist",    // contains "rapist"
    "Cocoon",            // contains "coon"
    "Pele",              // allow-listed
    "Dick Tracy",        // allow-listed name
    "Névtelen játékos",
    "Zsófi 2009",
  ])("%s", (name) => {
    expect(isDisplayNameAllowed(name)).toBe(true);
  });
});
