import { useTranslation } from 'react-i18next'
import RoomBadges from './RoomBadges'

/**
 * ROADMAP 7.2.6 — the opponent strip above the board during a room round: everyone's
 * name, found count, score and live badges — never which words (docs/multiplayer.md §1).
 * Co-op also shows the room's collective progress; versus deliberately doesn't (it would
 * tell you how much of the board your opponents hold).
 */
export default function RoomStrip({ room }) {
  const { t } = useTranslation()
  const possible = room.possible_count ?? 0
  return (
    <div className="mb-4 rounded-lg border border-game-border px-3 py-2 text-sm" data-testid="room-strip">
      {room.mode === 'coop' && room.room_found_count !== undefined && (
        <p className="mb-1 text-center font-semibold">
          {t('room.teamProgress', { found: room.room_found_count, total: possible })}
        </p>
      )}
      <ul className="flex flex-col gap-0.5" aria-label={t('room.membersLabel')}>
        {room.members.map((m) => (
          <li key={m.player_id} className={`flex items-center gap-2 ${m.done ? 'opacity-60' : ''}`}>
            <span className="flex-1 truncate font-semibold">
              {m.display_name ?? t('highScores.anonymous')}
              {m.is_you && <span className="ml-1 text-xs font-normal text-game-muted">({t('room.you')})</span>}
            </span>
            <RoomBadges badges={m.badges} />
            <span className="tabular-nums text-game-muted">{m.found_count}/{possible}</span>
            <span className="tabular-nums w-14 text-right">{t('room.points', { points: m.score })}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
