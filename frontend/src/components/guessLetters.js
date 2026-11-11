/**
 * Which typed letters can't come from the board? Returns one boolean per character of
 * `guess`: true = "not available". Covers both cases with one rule — hand out the board's
 * letters left to right, and a typed letter is unavailable when none of its kind is left:
 * a letter that isn't on the board at all never had one, and the third "A" on a board with
 * two has run out. So for board A-L-M-A, "ALMAA" marks only the last A, not all of them.
 */
export function unavailableLetters(guess, boardLetters) {
  const left = new Map()
  for (const letter of boardLetters) {
    const key = letter.toUpperCase()
    if (key.trim()) left.set(key, (left.get(key) ?? 0) + 1)
  }
  return [...guess.toUpperCase()].map((letter) => {
    const remaining = left.get(letter) ?? 0
    if (remaining === 0) return true
    left.set(letter, remaining - 1)
    return false
  })
}
