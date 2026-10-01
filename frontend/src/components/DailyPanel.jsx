import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { buildDailyShareText, shareDailyResult } from './dailyShare'

/**
 * ROADMAP Batch 10 item 1 — daily puzzle + streaks. Lives inside <SettingsPanel>: shows
 * today's puzzle (one shared board per day per wordlist+length), a Play / Replay button,
 * this player's completion streak, and the daily leaderboard.
 *
 * Playing reuses the whole normal game flow (App.jsx's startNewGame(..., daily=true) →
 * betuAPI.startDailyGame) — there is no separate game screen. `onPlayDaily` routes through
 * the same confirm-before-restart funnel the length/wordlist selectors use.
 *
 * `daily` is the /api/v1/daily payload (client.ts DailyView) or null while it loads.
 *
 * ROADMAP 11.20: once today's result exists, a Share button posts a word-free result card
 * (see dailyShare.js). Copy feedback is announced through a polite live region.
 */
export default function DailyPanel({ daily, loading, isDailyGame, onPlayDaily, controlsDisabled }) {
  const { t } = useTranslation()

  const alreadyPlayed = daily?.already_played ?? false
  const streak = daily?.streak ?? { current: 0, best: 0 }
  const leaderboard = daily?.leaderboard ?? []
  // 'copied' | 'failed' | null — 'shared'/'cancelled' need no message, the OS sheet was
  // the feedback.
  const [shareStatus, setShareStatus] = useState(null)

  useEffect(() => {
    if (!shareStatus) return undefined
    const timer = setTimeout(() => setShareStatus(null), 2500)
    return () => clearTimeout(timer)
  }, [shareStatus])

  const handleShare = async () => {
    const text = buildDailyShareText(t, daily, window.location.origin)
    const outcome = await shareDailyResult(text)
    setShareStatus(outcome === 'copied' || outcome === 'failed' ? outcome : null)
  }

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-bold uppercase tracking-wide text-game-muted">
        🗓️ {t('daily.title')}
      </h3>

      {loading && !daily && (
        <p className="text-xs text-game-muted">{t('daily.loading')}</p>
      )}

      {daily && (
        <>
          <p className="text-xs text-game-muted">
            {t('daily.forDate', { date: daily.puzzle_date })}
          </p>

          <div className="text-sm text-game-primary">
            🔥 {t('daily.currentStreak', { count: streak.current })}
            {streak.best > 0 && (
              <span className="text-game-muted"> · {t('daily.bestStreak', { count: streak.best })}</span>
            )}
          </div>

          {alreadyPlayed && daily.your_result && (
            <div className="text-sm font-semibold">
              {daily.your_result.completed
                ? <span className="text-game-success">✅ {t('daily.yourResult.completed')}</span>
                : <span className="text-game-muted">⏳ {t('daily.yourResult.notCompleted')}</span>}
              <span className="text-game-muted font-normal">
                {' '}· {t('daily.yourResult.score', { score: daily.your_result.final_score })}
              </span>
            </div>
          )}

          {alreadyPlayed && daily.your_result && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleShare}
                className="rounded-lg border border-game-secondary text-game-secondary text-sm font-bold px-3 py-1 hover:bg-game-secondary hover:text-white focus:outline-none focus:ring-2 focus:ring-game-secondary"
              >
                📤 {t('daily.share.button')}
              </button>
              <span role="status" aria-live="polite" className="text-xs text-game-muted">
                {shareStatus === 'copied' && t('daily.share.copied')}
                {shareStatus === 'failed' && t('daily.share.failed')}
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={onPlayDaily}
            disabled={controlsDisabled || isDailyGame}
            className="self-start rounded-lg bg-game-secondary text-white text-sm font-bold px-3 py-1.5 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-game-secondary disabled:opacity-50"
          >
            {isDailyGame
              ? t('daily.playing')
              : alreadyPlayed
                ? t('daily.replay')
                : t('daily.play')}
          </button>

          {leaderboard.length > 0 && (
            <ol className="mt-1 flex flex-col gap-0.5 text-sm">
              {leaderboard.map((entry, index) => (
                <li key={index} className="flex items-baseline gap-2">
                  <span className="text-game-muted tabular-nums w-5 text-right">{index + 1}.</span>
                  <span className="flex-1 truncate">{entry.display_name ?? t('highScores.anonymous')}</span>
                  <span aria-hidden="true">{entry.completed ? '✅' : '⏳'}</span>
                  <span className="tabular-nums font-semibold">{entry.final_score}</span>
                </li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  )
}
