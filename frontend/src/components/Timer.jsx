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
        className={`text-2xl font-bold ${timeLeft < 60 ? 'text-red-600 dark:text-red-400 animate-pulse' : 'text-game-primary'}`}
        role="timer"
        aria-label={t('score.timerAriaLabel', { time: `${Math.floor(timeLeft / 60)}:${(timeLeft % 60).toString().padStart(2, '0')}` })}
      >
        ⏳ {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
      </div>
    </div>
  )
}
