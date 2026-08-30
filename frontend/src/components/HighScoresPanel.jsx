import { useTranslation } from 'react-i18next'

/**
 * Server-side leaderboard for the active board length (ROADMAP 2.2): global top 10 +
 * this player's best, with the localStorage top-3 kept only as an offline/error
 * fallback. Extracted verbatim from App.jsx as part of the ROADMAP Batch 10 item 15
 * start-screen cleanup — it now renders inside <SettingsPanel> rather than mid-card.
 */
export default function HighScoresPanel({ serverScores, serverScoresLoading, highScores, targetLength }) {
  const { t } = useTranslation()

  return (
    <div className="p-4 bg-gray-50 dark:bg-slate-800/50 rounded-lg border-2 border-dashed border-gray-200 dark:border-slate-700">
      <h4 className="text-sm font-bold mb-2 text-center text-game-muted">
        {t('highScores.panelTitle', { length: targetLength })}
      </h4>
      {serverScoresLoading && (
        <p className="text-xs text-center text-game-muted">{t('highScores.loading')}</p>
      )}
      {!serverScoresLoading && serverScores && serverScores.top.length > 0 && (
        <ol className="text-sm space-y-1 max-w-xs mx-auto">
          {serverScores.top.map((entry, i) => (
            <li key={i} className="flex justify-between gap-4">
              <span className="truncate">{i + 1}. {entry.display_name}</span>
              <span className="font-bold">{entry.final_score}</span>
            </li>
          ))}
        </ol>
      )}
      {!serverScoresLoading && serverScores && serverScores.top.length === 0 && (
        <p className="text-xs text-center text-game-muted">{t('highScores.empty')}</p>
      )}
      {!serverScoresLoading && serverScores?.your_best && (
        <p className="text-xs text-center mt-3 text-game-muted">
          {t('highScores.yourBest')} <span className="font-bold">{serverScores.your_best.final_score}</span>
        </p>
      )}
      {!serverScoresLoading && !serverScores && highScores.length > 0 && (
        <>
          <p className="text-xs text-center text-game-muted mb-2">{t('highScores.offlineWithLocal')}</p>
          <div className="flex gap-4 justify-center text-xs text-game-muted">
            {highScores.map((s, i) => (
              <span key={i} className="font-bold">#{i + 1}: {s.score}</span>
            ))}
          </div>
        </>
      )}
      {!serverScoresLoading && !serverScores && highScores.length === 0 && (
        <p className="text-xs text-center text-game-muted">{t('highScores.offlineNone')}</p>
      )}
    </div>
  )
}
