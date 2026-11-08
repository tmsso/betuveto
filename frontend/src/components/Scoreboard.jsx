import { Sparkles, Trophy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useCountUp from './useCountUp'

/**
 * Score + find-progress display (ROADMAP Batch 10 item 3, App.jsx -> components/
 * refactor). Purely presentational — `displayScore` already has hints/completion bonus
 * folded in by App.jsx (lib/game.ts's floor-at-0 rule, mirrored client-side), and
 * `allPossibleWordsFound` is App.jsx's own derived flag, not recomputed here.
 */
export default function Scoreboard({
  displayScore,
  isScoreFlashing,
  preGame,
  foundWordsCount,
  possibleWordsCount,
  guessCount,
  allPossibleWordsFound,
}) {
  const { t } = useTranslation()
  // The visible number counts up; the aria-label keeps announcing the real value.
  const shownScore = useCountUp(displayScore)

  return (
    <div className="text-left">
      <div
        className={`text-3xl font-bold ${isScoreFlashing ? 'animate-pulse text-game-error' : 'text-game-primary'}`}
        aria-live="polite"
        aria-label={t('score.ariaLabel', { score: displayScore })}
      >
        <Trophy size={26} aria-hidden="true" className="inline -mt-1 mr-1 text-game-accent" /><span className="tabular-nums">{shownScore}</span> <span className="hidden sm:inline">{t('score.pointsSuffix')}</span>
      </div>
      {/* Hidden on the inert pre-game board (item 17) — there is no game to report
          progress for yet. */}
      {!preGame && (
        <div className={`text-md text-game-muted transition-all duration-1000 ${allPossibleWordsFound ? 'animate-pulse scale-110 font-bold text-game-success' : ''}`}>
          {t('score.progress', { found: foundWordsCount, total: possibleWordsCount, guesses: guessCount })} {allPossibleWordsFound && <Sparkles size={14} aria-hidden="true" className="inline text-game-accent" />}
        </div>
      )}
    </div>
  )
}
