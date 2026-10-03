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
            className="inline-flex items-center text-[11px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-full bg-gray-100 dark:bg-slate-700 border border-game-border text-game-muted"
            title={t('wordlistPill.title', { language: t(`wordlistPill.lang.${gameWordlist}`) })}
            aria-label={t('wordlistPill.title', { language: t(`wordlistPill.lang.${gameWordlist}`) })}
          >
            {gameWordlist.toUpperCase()}
          </span>
        </div>
      )}
      <div className="flex flex-wrap gap-2 sm:gap-3 justify-center max-w-[280px] sm:max-w-none mx-auto" role="group" aria-label={t('board.ariaLabel')}>
        {preGame
          ? /* Inert placeholder tiles (ROADMAP Batch 10 item 17) — the real letters
               aren't known until game/start; these just give the empty board a shape.
               Plain divs, so `board.getByRole('button')` finds nothing pre-game. */
            Array.from({ length: selectedLength }).map((_, index) => (
              <div
                key={index}
                aria-hidden="true"
                className="w-12 h-12 sm:w-14 sm:h-14 rounded-lg border-2 border-dashed border-game-border opacity-30"
              />
            ))
          : scrambledLetters.map((letter, index) => (
          <button
            key={index}
            onClick={() => onLetterClick(letter)}
            aria-label={t('board.letterAriaLabel', { letter })}
            className={`w-12 h-12 sm:w-14 sm:h-14 rounded-lg flex items-center justify-center text-2xl sm:text-3xl font-extrabold shadow-md transition-all transform active:scale-90 focus:outline-none focus:ring-2 focus:ring-opacity-50
            ${currentAnimatingIndex === index
              ? 'animate-pulse ring-4 ring-yellow-400 scale-125 z-10'
              : usedLetters[index]
                ? 'bg-gray-300 dark:bg-slate-600 border-gray-400 dark:border-slate-500 text-gray-700 dark:text-slate-200'
                : 'bg-blue-100 dark:bg-blue-500/20 border-2 border-blue-300 dark:border-blue-400/50 text-blue-800 dark:text-blue-200 hover:bg-blue-200 dark:hover:bg-blue-500/30 hover:-translate-y-1 hover:scale-110 focus:ring-blue-500'}`}
            disabled={usedLetters[index]}
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
