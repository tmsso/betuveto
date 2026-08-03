// Dictionary links are deliberately derived from the active *wordlist*, not the UI
// language: an English-interface player can still be playing a Hungarian board.
const WIKTIONARY_LANGUAGE_BY_WORDLIST: Record<string, string> = {
  hu: 'hu',
  en: 'en',
}

/** Return the language-appropriate Wiktionary entry URL for a game word. */
export function definitionUrl(word: string, wordlist: string): string | null {
  const language = WIKTIONARY_LANGUAGE_BY_WORDLIST[wordlist]
  if (!language) return null
  // The game stores words uppercase (lib/words.ts normalizes them that way), but
  // Wiktionary page titles are case-sensitive and lowercase for ordinary words —
  // an uppercase URL 404s.
  return `https://${language}.wiktionary.org/wiki/${encodeURIComponent(word.toLowerCase())}`
}
