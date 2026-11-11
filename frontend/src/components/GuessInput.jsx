import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { hasPhysicalKeyboard } from './focusGuessInput'
import { unavailableLetters } from './guessLetters'

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
  boardLetters = [],
}) {
  const { t } = useTranslation()

  // Was a plain `autoFocus`, which opened the phone keyboard on every page load. Now only a
  // mouse-and-keyboard device gets the cursor here on its own; a touch player taps the field.
  useEffect(() => {
    if (hasPhysicalKeyboard()) document.getElementById('guess-input')?.focus()
  }, [])

  // Letters the board can't supply (not on it, or more of them than it has) are shown in
  // the error colour as they are typed. A plain <input> can only have one text colour, so
  // when there is something to mark, the input's own text turns transparent (the caret
  // stays visible) and an identical line of text is drawn exactly on top of it, one <span>
  // per letter. With nothing to mark, the input renders by itself as before.
  const unavailable = unavailableLetters(value, boardLetters)
  const hasMarks = boardLetters.length > 0 && unavailable.includes(true)
  const textSize = value.length > 10 ? 'text-2xl sm:text-3xl' : 'text-4xl'

  return (
    <div className="mb-6 relative">
      {/* Temporary Error Overlay */}
      {errorMessage && (
        <div className="absolute -top-10 left-1/2 transform -translate-x-1/2 z-10 w-full text-center">
          {/* role="alert" (ROADMAP Batch 10 accessibility pass): an implicit
              assertive live region, so a screen reader announces a rejected guess
              even though nothing else on the page changes when it appears. */}
          <span role="alert" className="bg-game-error text-game-on-secondary text-sm font-bold px-3 py-1 rounded shadow-elev-2 animate-fade-out-up">
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
            `w-full min-h-[70px] bg-game-paper border-4 rounded-lg p-5 font-extrabold text-center uppercase
            shadow-inner focus:outline-none focus:ring-4 focus:ring-game-secondary caret-game-primary
            ${hasMarks ? 'text-transparent' : 'text-game-primary'}
            ${isShaking ? 'animate-shake border-game-error bg-game-error-soft ' : 'border-game-border'}
            ${textSize}`
          }
          aria-invalid={hasMarks || undefined}
          placeholder={t('guessInput.placeholder')}
          autoComplete="off"
          autoCorrect="off"
          spellCheck="false"
        />
        {hasMarks && (
          // Same box, border width, padding and font as the input, so the letters land on
          // the same pixels. aria-hidden: a screen reader already reads the input itself.
          <div
            aria-hidden="true"
            data-testid="guess-marks"
            className={`absolute inset-0 border-4 border-transparent p-5 flex items-center justify-center
              font-extrabold uppercase whitespace-pre overflow-hidden pointer-events-none
              ${isShaking ? 'animate-shake' : ''} ${textSize}`}
          >
            {[...value].map((letter, i) => (
              <span
                key={i}
                className={unavailable[i]
                  // Underlined too: colour alone is invisible to a colour-blind player.
                  ? 'text-game-error underline decoration-4 underline-offset-4'
                  : 'text-game-primary'}
              >
                {letter}
              </span>
            ))}
          </div>
        )}
        {value && (
          <button
            onClick={onClear}
            aria-label={t('guessInput.clearAriaLabel')}
            className="absolute right-3 top-1/2 -translate-y-1/2 bg-game-paper hover:bg-game-border rounded-full w-10 h-10 flex items-center justify-center text-game-primary text-xl"
          >
            <X size={20} aria-hidden="true" />
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
