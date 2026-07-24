/**
 * Word and board rules — the single source of truth shared by the importer, the API
 * functions, and the tests. Nothing here touches a database or the network.
 *
 * Matching is letter-by-letter: Hungarian digraphs (cs, sz, ...) are deliberately NOT
 * treated as single letters, and accented vowels are distinct from their bare forms
 * (ROADMAP decision 6.3). "Letter" therefore means "Unicode code point", which is why
 * everything below iterates with Array.from rather than indexing a UTF-16 string.
 */

export const MIN_WORD_LENGTH = 3; // shortest accepted / counted guess
export const MAX_WORD_LENGTH = 15; // longest word loaded from the dictionary
export const MIN_TARGET_LENGTH = 5; // shortest board a game may request
export const MAX_TARGET_LENGTH = 10; // longest board a game may request
export const DEFAULT_TARGET_LENGTH = 7;
// A board must offer at least this many candidate target words of its exact length to be
// offered in the length selector (ROADMAP 2.3) — guards against a future language/wordlist
// (Batch 6) or heavy word-curation (Batch 4) leaving some length too thin to pick from.
export const MIN_WORDS_PER_LENGTH = 500;

/** `duration = 120 + 15 × (length − 5)` (ROADMAP 2.3): longer boards have more findable
 *  words, so they get more time. 150s at the default length of 7. */
export function durationForLength(length: number): number {
  return 120 + 15 * (length - MIN_TARGET_LENGTH);
}

/** Trim, NFC-normalise, uppercase. Returns null if the word is out of range. */
export function normalizeWord(raw: string): string | null {
  const word = raw.trim().normalize("NFC").toUpperCase();
  if (!word) return null;
  const length = letterCount(word);
  if (length < MIN_WORD_LENGTH || length > MAX_WORD_LENGTH) return null;
  return word;
}

/** Trim/NFC/uppercase without imposing a length limit — for user guesses, which we
 *  must be able to reject with a specific message rather than silently drop. */
export function normalizeGuess(raw: string): string {
  return raw.trim().normalize("NFC").toUpperCase();
}

export function letterCount(word: string): number {
  return Array.from(word).length;
}

/** Letters sorted by code point. A board can form exactly the words whose signature is
 *  a multiset-subset of the board's own signature. */
export function signatureOf(word: string): string {
  return Array.from(word).sort().join("");
}

/** True if `word` can be built from the letters of `board`, respecting duplicates. */
export function canFormWord(word: string, board: string): boolean {
  const budget = new Map<string, number>();
  for (const letter of Array.from(board)) {
    budget.set(letter, (budget.get(letter) ?? 0) + 1);
  }
  for (const letter of Array.from(word)) {
    const left = budget.get(letter) ?? 0;
    if (left === 0) return false;
    budget.set(letter, left - 1);
  }
  return true;
}

/**
 * Every distinct sub-multiset of the board's letters with at least `minLength` letters,
 * as sorted signatures. This is what turns "find the playable words" into one indexed
 * `signature = any(...)` lookup instead of a scan over 155k rows: a 7-letter board
 * yields ~99 signatures, a 10-letter board ~721.
 *
 * Recursing over (letter, count) pairs rather than positions means a board with repeated
 * letters produces each distinct signature once, not once per permutation of the copies.
 */
export function subSignatures(board: string, minLength: number = MIN_WORD_LENGTH): string[] {
  const counts = new Map<string, number>();
  for (const letter of Array.from(board)) {
    counts.set(letter, (counts.get(letter) ?? 0) + 1);
  }
  const distinct = [...counts.keys()].sort();

  const out: string[] = [];
  const picked: string[] = [];

  const walk = (index: number, length: number): void => {
    if (index === distinct.length) {
      if (length >= minLength) out.push(picked.join(""));
      return;
    }
    const letter = distinct[index];
    const available = counts.get(letter)!;
    for (let take = 0; take <= available; take++) {
      walk(index + 1, length + take);
      picked.push(letter); // one more copy for the next iteration
    }
    picked.length -= available + 1; // undo every copy pushed by this frame
  };

  walk(0, 0);
  return out;
}

/**
 * Shuffle the board's letters for display, avoiding the original order when possible.
 * Returned space-separated, matching the shape the frontend already renders.
 */
export function scrambleWord(word: string): string {
  const letters = Array.from(word);
  if (letters.length < 2) return word;
  for (let attempt = 0; attempt < 10; attempt++) {
    for (let i = letters.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [letters[i], letters[j]] = [letters[j], letters[i]];
    }
    if (letters.join("") !== word) break;
  }
  return letters.join(" ");
}

/** The letters of a board, recovered from the space-separated scrambled display form. */
export function lettersOf(scrambled: string): string {
  return scrambled.split(" ").join("");
}

export function scoreFor(word: string): number {
  return letterCount(word) ** 2;
}
