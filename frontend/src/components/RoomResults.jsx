import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import RoomBadges from './RoomBadges'

/**
 * ROADMAP 7.2.6 — the end of a room round: the ranked comparison (🏆 on rank 1 in versus),
 * each member's words on demand, the target and what nobody found, the co-op result, and
 * what's next — Rematch for the host, "Join the rematch" for everyone else once the host
 * has made one, or back to solo play.
 */
export default function RoomResults({ room, busy, error, onRematch, onJoinRematch, onBackToSolo }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(null) // player_id whose words are expanded
  const reveal = room.reveal
  if (!reveal) return null
  const versus = room.mode === 'versus'

  return (
    <div className="mb-6 flex flex-col gap-3" data-testid="room-results">
      <h3 className="text-xl font-bold text-center">{t('room.resultsTitle')}</h3>
      {!versus && (
        <p className="text-center text-sm font-semibold">
          {reveal.room_cleared
            ? t('room.clearedTogether', { bonus: reveal.bonus_per_member })
            : t('room.notCleared', { count: reveal.remaining_words.length })}
        </p>
      )}
      <p className="text-center text-sm">
        {t('room.targetWas')} <strong className="tracking-wide">{reveal.target_word}</strong>
      </p>
      <ol className="flex flex-col gap-1">
        {reveal.members.map((m) => (
          <li key={m.player_id} className="rounded-lg border border-game-border px-3 py-1.5 text-sm">
            <button
              type="button"
              onClick={() => setOpen(open === m.player_id ? null : m.player_id)}
              aria-expanded={open === m.player_id}
              className="w-full flex items-center gap-2 text-left"
            >
              <span className="w-8 font-bold tabular-nums">
                {versus && m.rank === 1 ? '🏆' : `${m.rank}.`}
              </span>
              <span className="flex-1 truncate font-semibold">{m.display_name ?? t('highScores.anonymous')}</span>
              <RoomBadges badges={m.badges} />
              <span className="tabular-nums text-game-muted">{t('room.wordsCount', { count: m.found_count })}</span>
              <span className="tabular-nums w-16 text-right font-bold">{t('room.points', { points: m.final_score })}</span>
            </button>
            {open === m.player_id && (
              <p className="mt-1 text-xs text-game-muted break-words">
                {m.words.length ? m.words.join(', ') : t('room.noWords')}
              </p>
            )}
          </li>
        ))}
      </ol>
      {reveal.remaining_words.length > 0 && (
        <details className="text-xs text-game-muted">
          <summary className="cursor-pointer">{t('room.nobodyFound', { count: reveal.remaining_words.length })}</summary>
          <p className="mt-1 break-words">{reveal.remaining_words.join(', ')}</p>
        </details>
      )}
      <div className="flex flex-wrap justify-center gap-3 pt-2">
        {room.is_host ? (
          <button
            type="button"
            disabled={busy}
            onClick={onRematch}
            className="h-11 px-6 rounded-full shadow bg-game-secondary text-white font-semibold hover:bg-blue-600 disabled:opacity-50"
          >
            {t('room.rematch')}
          </button>
        ) : room.next_room_code ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onJoinRematch(room.next_room_code)}
            className="h-11 px-6 rounded-full shadow bg-game-secondary text-white font-semibold hover:bg-blue-600 disabled:opacity-50"
          >
            {t('room.joinRematch')}
          </button>
        ) : (
          <p className="text-xs text-game-muted self-center">{t('room.waitingForRematch')}</p>
        )}
        <button type="button" onClick={onBackToSolo} className="text-sm underline text-game-secondary">
          {t('room.backToSolo')}
        </button>
      </div>
      {error && <p role="alert" className="text-center text-xs text-red-600 dark:text-red-400">{t(error)}</p>}
    </div>
  )
}
