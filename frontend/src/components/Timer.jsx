import { Hourglass } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Countdown display (ROADMAP Batch 10 item 3, App.jsx -> components/ refactor). Purely
 * presentational: the server owns the deadline and App.jsx's own effect renders the
 * remaining time into `timeLeft` — this component only ever reads that number, so it
 * carries none of the countdown/resync logic itself.
 */
export default function Timer({ timeLeft }) {
  const { t } = useTranslation()

  return (
    <div className="flex items-center justify-center space-x-2">
      <div
        className={`flex items-center gap-1.5 text-2xl font-bold tabular-nums ${timeLeft < 60 ? 'text-game-error animate-pulse' : 'text-game-primary'}`}
        role="timer"
        aria-label={t('score.timerAriaLabel', { time: `${Math.floor(timeLeft / 60)}:${(timeLeft % 60).toString().padStart(2, '0')}` })}
      >
        <Hourglass className="h-6 w-6" aria-hidden="true" />
        {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
      </div>
    </div>
  )
}
