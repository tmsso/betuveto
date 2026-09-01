import { useTranslation } from 'react-i18next'

/**
 * Player stats (ROADMAP 3.3): server-side, aggregate only — games played, completion
 * rate, average score per length. Per-word solve/fail history is deliberately not shown
 * to players (product decision 2026-07-30 — this isn't a practice game). Extracted
 * verbatim from App.jsx for the ROADMAP Batch 10 item 15 start-screen cleanup; it now
 * renders inside <SettingsPanel>.
 *
 * Achievements (ROADMAP Batch 10 item 10) render as a badge grid below the stats. The
 * full catalog always shows — locked entries greyed out — so a new or anonymous player
 * sees what there is to earn (anonymous players never unlock anything: a stable identity
 * is required, same as streaks). Badge copy is word-agnostic on purpose: a badge never
 * names the word that earned it (betuveto-no-player-facing-word-history).
 */
export default function StatsPanel({ stats, statsLoading, achievements, achievementsLoading }) {
  const { t, i18n } = useTranslation()

  const dateFmt = new Intl.DateTimeFormat(i18n.language === 'hu' ? 'hu-HU' : 'en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })

  return (
    <div className="p-4 bg-gray-50 dark:bg-slate-800/50 rounded-lg border-2 border-dashed border-gray-200 dark:border-slate-700 space-y-4">
      <div>
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

      <div className="border-t border-gray-200 dark:border-slate-700 pt-4">
        <p className="text-xs font-bold text-center text-game-muted mb-3">{t('achievements.title')}</p>
        {achievementsLoading && !achievements && (
          <p className="text-xs text-center text-game-muted">{t('stats.loading')}</p>
        )}
        {!achievements && !achievementsLoading && (
          <p className="text-xs text-center text-game-muted">{t('stats.offline')}</p>
        )}
        {achievements && (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {achievements.achievements.map((a) => {
              const unlocked = Boolean(a.unlocked_at)
              return (
                <li
                  key={a.key}
                  className={`flex gap-2 items-start rounded-lg border px-2.5 py-2 text-xs ${
                    unlocked
                      ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-900 text-amber-900 dark:text-amber-200'
                      : 'bg-game-surface border-gray-200 dark:border-slate-700 text-game-muted opacity-70'
                  }`}
                >
                  <span aria-hidden="true" className="text-base leading-none mt-0.5">
                    {unlocked ? '🏆' : '🔒'}
                  </span>
                  <span className="flex-1">
                    <span className="block font-semibold">{t(`achievements.items.${a.key}.name`)}</span>
                    <span className="block">{t(`achievements.items.${a.key}.desc`)}</span>
                    {unlocked && (
                      <span className="block mt-0.5 opacity-80">
                        {t('achievements.unlockedOn', { date: dateFmt.format(new Date(a.unlocked_at)) })}
                      </span>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
