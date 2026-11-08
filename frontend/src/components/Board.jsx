import { useTranslation } from 'react-i18next'

/**
 * The letter board (ROADMAP Batch 10 item 3, App.jsx -> components/ refactor): the
 * wordlist-language pill (item 16), the scrambled-letter tiles / pre-game placeholders
 * (item 17), and the pre-game hint text. Purely presentational — `usedLetters` and
 * `currentAnimatingIndex` are already derived/tracked in App.jsx, and letter clicks are
 * reported up via `onLetterClick` rather than touching `currentGuess` here.
 */
export default function Board({
  preGame,
  gameWordlist,
  scrambledLetters,
  selectedLength,
  currentAnimatingIndex,
  usedLetters,
  onLetterClick,
}) {
  const { t, i18n } = useTranslation()

  return (
    <div className="mb-8 text-center">
      {/* Wordlist-language pill (ROADMAP Batch 10 item 16) — shown only when the board's
          wordlist differs from the UI language, so the mismatch isn't missed now that the
          wordlist selector lives behind the settings drawer (item 15). A two-letter pill,
          not a flag emoji: flag glyphs fall back to bare letter pairs on Windows Chrome. */}
      {!preGame && gameWordlist && gameWordlist !== i18n.language && (
        <div className="mb-3 flex justify-center">
          <span
            className="inline-flex items-center text-[11px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-full bg-game-paper border border-game-border text-game-muted"
            title={t('wordlistPill.title', { language: t(`wordlistPill.lang.${gameWordlist}`) })}
            aria-label={t('wordlistPill.title', { language: t(`wordlistPill.lang.${gameWordlist}`) })}
          >
            {gameWordlist.toUpperCase()}
          </span>
        </div>
      )}
      <div className="flex flex-wrap gap-2 sm:gap-3 justify-center max-w-[330px] sm:max-w-none mx-auto" role="group" aria-label={t('board.ariaLabel')}>
        {preGame
          ? /* Inert placeholder tiles (ROADMAP Batch 10 item 17) — the real letters
               aren't known until game/start; these just give the empty board a shape.
               Plain divs, so `board.getByRole('button')` finds nothing pre-game. */
            Array.from({ length: selectedLength }).map((_, index) => (
              <div
                key={index}
                aria-hidden="true"
                className="tile tile-placeholder"
              />
            ))
          : scrambledLetters.map((letter, index) => (
          <button
            key={index}
            onClick={() => onLetterClick(letter)}
            aria-label={t('board.letterAriaLabel', { letter })}
            // Tile look lives in index.css (.tile*) — the bevel is an inset box-shadow, and
            // hover/press only translate (never scale) so the hit target never moves.
            className={`tile ${currentAnimatingIndex === index ? 'tile-hint' : ''}`}            disabled={usedLetters[index]}
          >
            {letter}
          </button>
        ))}
      </div>
      {preGame && (
        <p className="mt-4 text-sm text-game-muted" aria-live="polite">
          {t('preGame.hint')}
        </p>
      )}
    </div>
  )
}
