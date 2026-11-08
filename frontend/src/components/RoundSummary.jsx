import { CalendarDays, Dices, Flame, Sparkles, Trophy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useCountUp from './useCountUp'

/**
 * End-of-round summary (design handback §5, tiers 3/4/6 + "end-of-round summary"): the
 * card that sits above the word list once a solo or daily game is over. Purely
 * presentational — App.jsx decides what happened (cleared, new best, daily streak).
 * Slides up + fades in via `animate-summary-in`; reduced motion leaves only the fade
 * (the global reduced-motion rule shortens it to an instant).
 */
export default function RoundSummary({
  score, foundCount, totalCount, longestWord, fullWord, cleared, noHint, newBest,
  isDaily, streak, onNewGame,
}) {
  const { t } = useTranslation()
  const shown = useCountUp(score, 900)

  return (
    <section
      data-testid="round-summary"
      aria-labelledby="round-summary-title"
      className="relative mb-6 rounded-2xl bg-game-paper shadow-elev-1 px-5 py-4 text-center animate-summary-in"
    >
      {newBest && (
        <span className="absolute -top-3 right-4 inline-flex items-center gap-1 rounded-full bg-game-accent-fill text-game-on-accent text-xs font-extrabold px-3 py-1 shadow-elev-1 animate-stamp">
          <Sparkles size={14} aria-hidden="true" />
          {t('summary.newBest')}
        </span>
      )}
      <h3 id="round-summary-title" className="font-display text-2xl font-extrabold">
        {cleared ? t('summary.cleared') : t('summary.title')}
      </h3>
      <p className="mt-1 text-4xl font-extrabold tabular-nums text-game-secondary" aria-label={t('score.ariaLabel', { score })}>
        <Trophy size={30} aria-hidden="true" className="inline -mt-1.5 mr-1 text-game-accent" />
        {shown}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-left max-w-xs mx-auto">
        <dt className="text-game-muted">{t('summary.words')}</dt>
        <dd className="font-bold text-right tabular-nums">{foundCount}/{totalCount}</dd>
        {longestWord && (
          <>
            <dt className="text-game-muted">{t('summary.longest')}</dt>
            <dd className="font-bold text-right tracking-wide">{longestWord}</dd>
          </>
        )}
        {fullWord && (
          <>
            <dt className="text-game-muted">{t('summary.fullWord')}</dt>
            <dd className="font-bold text-right tracking-wide text-game-secondary">{fullWord}</dd>
          </>
        )}
      </dl>
      {(noHint || isDaily) && (
        <div className="mt-3 flex flex-wrap justify-center gap-2 text-xs font-bold">
          {noHint && cleared && (
            <span className="rounded-full bg-game-success-soft px-3 py-1">{t('summary.noHint')}</span>
          )}
          {isDaily && (
            <span className="inline-flex items-center gap-1 rounded-full bg-game-warning-soft px-3 py-1">
              <CalendarDays size={14} aria-hidden="true" />
              {t('daily.badge')}
              {streak > 0 && (
                <>
                  <Flame size={14} aria-hidden="true" className="ml-1 text-game-accent animate-flame" />
                  {t('daily.currentStreak', { count: streak })}
                </>
              )}
            </span>
          )}
        </div>
      )}
      {/* After a daily there's no second daily today, so the next step is a normal game —
          offered right here (owner review 2026-11-08: it used to need a page refresh). */}
      {isDaily && onNewGame && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={onNewGame}
            className="inline-flex items-center gap-2 rounded-full bg-game-button px-5 py-2.5 text-sm font-semibold text-game-on-secondary shadow-elev-1 hover:bg-game-button-hover"
          >
            <Dices size={18} aria-hidden="true" />
            {t('summary.newGame')}
          </button>
        </div>
      )}
    </section>
  )
}
