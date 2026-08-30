import { useTranslation } from 'react-i18next'

/**
 * Player stats (ROADMAP 3.3): server-side, aggregate only — games played, completion
 * rate, average score per length. Per-word solve/fail history is deliberately not shown
 * to players (product decision 2026-07-30 — this isn't a practice game). Extracted
 * verbatim from App.jsx for the ROADMAP Batch 10 item 15 start-screen cleanup; it now
 * renders inside <SettingsPanel>.
 */
export default function StatsPanel({ stats, statsLoading }) {
  const { t } = useTranslation()

  return (
    <div className="p-4 bg-gray-50 dark:bg-slate-800/50 rounded-lg border-2 border-dashed border-gray-200 dark:border-slate-700">
      {statsLoading && <p className="text-xs text-center text-game-muted">{t('stats.loading')}</p>}
      {!statsLoading && stats && stats.games_played === 0 && (
        <p className="text-xs text-center text-game-muted">{t('stats.noGames')}</p>
      )}
      {!statsLoading && stats && stats.games_played > 0 && (
        <>
          <div className="text-sm text-center text-game-muted mb-3 space-y-1">
            <p>{t('stats.gamesPlayed')} <span className="font-bold">{stats.games_played}</span></p>
            <p>{t('stats.completionRate')} <span className="font-bold">{Math.round(stats.completion_rate * 100)}%</span></p>
          </div>
          {Object.keys(stats.average_score_by_length).length > 0 && (
            <div className="text-xs text-center text-game-muted mb-3">
              <p className="font-bold mb-1">{t('stats.avgScoreHeader')}</p>
              <div className="flex flex-wrap gap-2 justify-center">
                {Object.entries(stats.average_score_by_length).map(([len, avg]) => (
                  <span key={len} className="px-2 py-1 bg-game-surface rounded border border-gray-200 dark:border-slate-700">
                    {t('stats.avgScoreEntry', { length: len, avg: Math.round(avg) })}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      {!statsLoading && !stats && (
        <p className="text-xs text-center text-game-muted">{t('stats.offline')}</p>
      )}
    </div>
  )
}
