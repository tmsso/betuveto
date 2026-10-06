/**
 * ROADMAP 13.6 — "select suspicious" heuristics for the admin words tab. Pure functions,
 * no database: they only *suggest* words for an admin to review (the UI pre-ticks them),
 * never change anything on their own.
 *
 * Hungarian needs a letter tokenizer, not a character count. cs, dz, dzs, gy, ly, ny, sz,
 * ty and zs are single consonants, so "ország" has a two-consonant cluster (r, sz), not
 * three. A doubled (long) consonant counts once too: "tt" in "kettő", and the doubled
 * digraph spellings "ssz", "ggy", "nny", "tty", "lly", "ccs", "zzs" (and "ddzs"). Without
 * this, real words like "legszebb" or "hangszer" would be flagged.
 */

export type SuspicionReason =
  | "vowels_only"
  | "consonants_only"
  | "too_short"
  | "foreign_letter"
  | "vowel_run"
  | "consonant_run";

export interface SuspicionParams {
  /** Words with fewer letters than this are flagged. */
  minLength: number;
  /** A run of MORE vowels than this is flagged (default 3 → 4+ in a row). */
  maxVowelRun: number;
  /** A run of MORE consonant sounds than this is flagged (default 4 → 5+ in a row). */
  maxConsonantRun: number;
}

// Owner decision D-13a (2026-10-06): 4+ vowels / 5+ consonants in a row. The first
// spec (3+ / 4+) flagged ~640 real Hungarian compounds and loanwords on the 152k list;
// these flag ~26, nearly all Latin taxonomy. Still adjustable per scan in the admin UI.
export const DEFAULT_SUSPICION_PARAMS: SuspicionParams = {
  minLength: 3,
  maxVowelRun: 3,
  maxConsonantRun: 4,
};

interface LanguageRules {
  vowels: Set<string>;
  /** Multi-letter consonants, longest first so "dzs" wins over "dz". */
  digraphs: string[];
  /** Letters that are fine inside a digraph but foreign on their own (hu: Y in "gy"). */
  foreignAlone: Set<string>;
}

const HU: LanguageRules = {
  vowels: new Set([..."AÁEÉIÍOÓÖŐUÚÜŰ"]),
  digraphs: ["DZS", "CS", "DZ", "GY", "LY", "NY", "SZ", "TY", "ZS"],
  foreignAlone: new Set([..."QWXY"]),
};

// English has no digraph consonants in this sense, and Y is treated as a vowel so "rhythm"
// and "crypt" aren't flagged as consonant-only.
const EN: LanguageRules = {
  vowels: new Set([..."AEIOUY"]),
  digraphs: [],
  foreignAlone: new Set(),
};

function rulesFor(wordlistCode: string): LanguageRules {
  return wordlistCode === "hu" ? HU : EN;
}

interface Token {
  text: string;
  vowel: boolean;
}

/** Splits an uppercase word into letters (Hungarian digraphs as one), merging a doubled
 *  consonant (TT, SSZ, GGY, DDZS…) into one long-consonant token. */
export function tokenize(word: string, wordlistCode = "hu"): Token[] {
  const rules = rulesFor(wordlistCode);
  const chars = [...word.normalize("NFC").toUpperCase()];
  const tokens: Token[] = [];
  let i = 0;
  while (i < chars.length) {
    const rest = chars.slice(i).join("");
    const first = chars[i]!;
    // Doubled digraph: the first letter written twice ("SSZ" = long "SZ").
    const doubled = rules.digraphs.find((d) => rest.startsWith(first + d) && d.startsWith(first));
    if (doubled) {
      tokens.push({ text: first + doubled, vowel: false });
      i += 1 + [...doubled].length;
      continue;
    }
    const digraph = rules.digraphs.find((d) => rest.startsWith(d));
    if (digraph) {
      tokens.push({ text: digraph, vowel: false });
      i += [...digraph].length;
      continue;
    }
    const vowel = rules.vowels.has(first);
    const prev = tokens[tokens.length - 1];
    if (!vowel && prev && !prev.vowel && prev.text === first) {
      prev.text += first; // doubled single consonant ("TT") — one long consonant
    } else {
      tokens.push({ text: first, vowel });
    }
    i += 1;
  }
  return tokens;
}

/** Every reason a word looks wrong, empty if none. `alphabet` is the wordlist's accepted
 *  letters (wordlists.alphabet); anything outside it is foreign as well. */
export function suspicionReasons(
  word: string,
  wordlistCode: string,
  alphabet: string,
  params: SuspicionParams = DEFAULT_SUSPICION_PARAMS,
): SuspicionReason[] {
  const rules = rulesFor(wordlistCode);
  const upper = word.normalize("NFC").toUpperCase();
  const letters = [...upper];
  const tokens = tokenize(upper, wordlistCode);
  const reasons: SuspicionReason[] = [];

  const vowelTokens = tokens.filter((t) => t.vowel).length;
  if (vowelTokens === tokens.length) reasons.push("vowels_only");
  if (vowelTokens === 0) reasons.push("consonants_only");
  if (letters.length < params.minLength) reasons.push("too_short");

  const allowed = new Set([...alphabet.toUpperCase()]);
  // Outside the wordlist's alphabet, or a letter that is only native inside a digraph
  // (hu: a lone Y, as in "WHISKY") or not at all (hu: Q, W, X — never part of a digraph).
  const foreign =
    letters.some((c) => !allowed.has(c)) ||
    tokens.some((t) => [...t.text].every((c) => rules.foreignAlone.has(c)));
  if (foreign) reasons.push("foreign_letter");

  let vowelRun = 0;
  let consonantRun = 0;
  let maxVowel = 0;
  let maxConsonant = 0;
  for (const t of tokens) {
    if (t.vowel) {
      vowelRun += 1;
      consonantRun = 0;
    } else {
      consonantRun += 1;
      vowelRun = 0;
    }
    maxVowel = Math.max(maxVowel, vowelRun);
    maxConsonant = Math.max(maxConsonant, consonantRun);
  }
  // Runs only matter for mixed words; an all-vowel word is already "vowels_only".
  if (maxVowel > params.maxVowelRun && vowelTokens < tokens.length) reasons.push("vowel_run");
  if (maxConsonant > params.maxConsonantRun && vowelTokens > 0) reasons.push("consonant_run");
  return reasons;
}
