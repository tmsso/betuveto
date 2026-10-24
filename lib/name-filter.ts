/**
 * Display-name blocklist (store-readiness UGC gap, ROADMAP Batch 14). Display names are
 * the one piece of player-written text other players see (leaderboards, rooms), so they
 * get a cheap offensive-word check; feedback and word suggestions only reach the admin.
 *
 * The lists come from LDNOOBW (CC BY 4.0, see data/README.md) and are compiled into
 * lib/name-blocklist.generated.ts by scripts/build-name-blocklist.ts. Two match modes:
 * - `exact`: a word of the name must equal the entry. Used for short entries (2–4
 *   letters: "ass" must not block "Kassai") and for entries that begin real words in our
 *   own wordlists ("franc" would block "Franciska", "barom" "baromfi").
 * - `prefix`: a word of the name that *starts with* the entry is blocked too, which
 *   catches Hungarian suffixed forms ("kurvák") without blocking words that merely
 *   contain the entry somewhere ("huszár" contains "szar").
 * Substring matching was measured and rejected: it hit 269 legitimate hu words and 735
 * en words (barométer, lövészárok, therapist, cocoon).
 *
 * The admin rename tool (lib/admin-players.ts) deliberately skips this: the admin is
 * the escape hatch for a false positive, and must never be blocked from fixing a name.
 */
import { NAME_BLOCKLIST } from "./name-blocklist.generated.js";

/** Real names / harmless words the source list contains as standalone entries. */
const ALLOWED = new Set(["pele", "búr", "dick"]);

const LEET: Record<string, string> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s" };

/** Shared with the generator so list entries and names normalise identically. Keeps
 *  accents: stripping them would turn "bürokrácia" into a "burok" hit. */
export function normalizeForBlocklist(text: string): string {
  return text
    .normalize("NFC")
    .toLocaleLowerCase("hu")
    .replace(/[013457@$]/g, (c) => LEET[c]);
}

/** Letters only: "F.a.s.z" and "k u r v a" collapse to the bare word. */
export function lettersOnly(text: string): string {
  return text.replace(/[^\p{L}]/gu, "");
}

const exact = new Set(NAME_BLOCKLIST.exact);
const prefix = NAME_BLOCKLIST.prefix;

function blocked(word: string): boolean {
  if (word.length === 0 || ALLOWED.has(word)) return false;
  if (exact.has(word)) return true;
  return prefix.some((entry) => word.startsWith(entry));
}

/** True if the name may be shown to other players. Each word is checked, then the whole
 *  name with separators removed (spaced-out spellings, multi-word list entries). */
export function isDisplayNameAllowed(name: string): boolean {
  const normalized = normalizeForBlocklist(name);
  const words = normalized.split(/[^\p{L}]+/u).filter(Boolean);
  if (words.some(blocked)) return false;
  return !blocked(lettersOnly(normalized));
}
