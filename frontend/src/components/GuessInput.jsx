import { useTranslation } from 'react-i18next'

/**
 * The guess text field (ROADMAP Batch 10 item 3, App.jsx -> components/ refactor): input
 * + clear button, the rejected-guess error overlay, and the word-suggestion prompt
 * (ROADMAP 4.2). Purely presentational — the uppercase/15-char formatting stays here
 * (it's input-specific, not game state), but `onChange` and `onClear` are deliberately
 * separate props: App.jsx's `onChange` path also clears a pending suggestion prompt on
 * every keystroke, while the clear (✖️) button intentionally does not — preserved
 * exactly as it behaved before this extraction, not "fixed" into matching.
 */
export default function GuessInput({
  value,
  onChange,
  onClear,
  isShaking,
  errorMessage,
  suggestPrompt,
  suggestThanks,
  suggestLoading,
  onSuggestWord,
}) {
  const { t } = useTranslation()

  return (
    <div className="mb-6 relative">
      {/* Temporary Error Overlay */}
      {errorMessage && (
        <div className="absolute -top-10 left-1/2 transform -translate-x-1/2 z-10 w-full text-center">
          {/* role="alert" (ROADMAP Batch 10 accessibility pass): an implicit
              assertive live region, so a screen reader announces a rejected guess
              even though nothing else on the page changes when it appears. */}
          <span role="alert" className="bg-red-500 text-white text-sm font-bold px-3 py-1 rounded shadow-lg animate-fade-out-up">
            {errorMessage}
          </span>
        </div>
      )}

      <div className="relative">
        <input
          id="guess-input"
          type="text"
          aria-label={t('guessInput.ariaLabel')}
          value={value}
          onChange={(e) => {
            const val = e.target.value.toUpperCase();
            // Limit to 15 characters
            if (val.length <= 15) onChange(val);
          }}
          className={
            `w-full min-h-[70px] bg-game-paper border-4 rounded-lg p-5 font-extrabold text-game-primary text-center uppercase
            shadow-inner focus:outline-none focus:ring-4 focus:ring-game-secondary
            ${isShaking ? 'animate-shake border-game-error bg-red-50 dark:bg-red-950/40 ' : 'border-game-border'}
            ${value.length > 10 ? 'text-2xl sm:text-3xl' : 'text-4xl'}`
          }
          placeholder={t('guessInput.placeholder')}
          autoComplete="off"
          autoCorrect="off"
          spellCheck="false"
          autoFocus // Auto-focus on load
        />
        {value && (
          <button
            onClick={onClear}
            aria-label={t('guessInput.clearAriaLabel')}
            className="absolute right-3 top-1/2 -translate-y-1/2 bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-600 rounded-full w-10 h-10 flex items-center justify-center text-gray-700 dark:text-slate-200 text-xl"
          >
            ✖️
          </button>
        )}
      </div>

      {/* Word curation (ROADMAP 4.2): offer to submit a rejected guess as a word the
          dictionary might be missing. Replaced by a brief thanks confirmation on submit. */}
      {(suggestPrompt || suggestThanks) && (
        <div className="absolute -bottom-7 left-1/2 transform -translate-x-1/2 z-10 w-full text-center">
          <span role="status" aria-live="polite" className="text-xs sm:text-sm text-game-primary/70">
            {suggestThanks ? (
              t('suggestion.thanks')
            ) : (
              <>
                {t('suggestion.prompt')}{' '}
                <button
                  onClick={() => onSuggestWord(suggestPrompt)}
                  disabled={suggestLoading}
                  className="underline font-bold hover:text-game-primary disabled:opacity-50"
                >
                  {t('suggestion.submit')}
                </button>
              </>
            )}
          </span>
        </div>
      )}
    </div>
  )
}
