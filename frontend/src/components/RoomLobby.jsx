import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReportNameButton from './ReportNameButton.jsx'

/** The shareable invite link for a room (the `?room=CODE` deep link, ROADMAP 7.2.5). */
function roomLink(code) {
  return `${window.location.origin}/?room=${code}`
}

/**
 * ROADMAP 7.2.5 — the lobby, shown in place of the pre-game board while a room waits to
 * start: the code to share, who's here (with an "online" dot from the snapshot's presence
 * window), the mode, and Start (host, needs 2+) / Leave.
 */
export default function RoomLobby({ room, busy, error, onStart, onLeave }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const canStart = room.is_host && room.member_count >= 2

  // ROADMAP 11.22: when the host leaves, the next member is promoted on the next poll. Tell
  // them once, so the sudden Start button is not a surprise.
  // (Adjusting state while rendering, React's documented alternative to a setState effect.)
  const [prevIsHost, setPrevIsHost] = useState(room.is_host)
  const [promoted, setPromoted] = useState(false)
  if (room.is_host !== prevIsHost) {
    setPrevIsHost(room.is_host)
    if (room.is_host) setPromoted(true)
  }

  const share = async () => {
    const url = roomLink(room.code)
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Betűvető', text: t('room.shareText', { code: room.code }), url })
        return
      }
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* share sheet dismissed, or clipboard blocked — the code is on screen anyway */
    }
  }

  return (
    <div className="mb-6 flex flex-col items-center gap-4 text-center" data-testid="room-lobby">
      <p className="text-sm text-game-muted">
        {room.mode === 'versus' ? '⚔️' : '👥'} {t(`room.mode.${room.mode}.name`)}
        {room.mode === 'coop' && ` (${t(`room.visibility.${room.visibility ?? 'private'}.name`)})`} · {t('room.lengthInfo', { length: room.target_length })}
      </p>
      <div>
        <p className="text-xs uppercase tracking-wide text-game-muted">{t('room.codeLabel')}</p>
        <p className="text-4xl font-extrabold tracking-[0.3em] font-display" aria-label={t('room.codeAria', { code: room.code.split('').join(' ') })}>
          {room.code}
        </p>
      </div>
      <button
        type="button"
        onClick={share}
        className="text-sm underline text-game-secondary hover:text-blue-700 dark:hover:text-blue-300"
      >
        {copied ? t('room.copied') : t('room.share')}
      </button>

      <ul className="w-full max-w-xs flex flex-col gap-1 text-left" aria-label={t('room.membersLabel')}>
        {room.members.map((m) => (
          <li key={m.player_id} className="flex items-center gap-2 text-sm">
            <span
              aria-label={m.online ? t('room.online') : t('room.offline')}
              className={`inline-block h-2 w-2 rounded-full ${m.online ? 'bg-green-500' : 'bg-gray-300 dark:bg-slate-600'}`}
            />
            <span className="font-semibold truncate">{m.display_name ?? t('highScores.anonymous')}</span>
            {m.is_host && <span title={t('room.host')} aria-label={t('room.host')}>👑</span>}
            {m.is_you && <span className="text-xs text-game-muted">({t('room.you')})</span>}
            {!m.is_you && <span className="ml-auto"><ReportNameButton name={m.display_name} place="room" /></span>}
          </li>
        ))}
      </ul>
      <p className="text-xs text-game-muted">{t('room.memberCount', { count: room.member_count, max: room.max_members })}</p>

      {promoted && room.is_host && (
        <p role="status" data-testid="now-host" className="text-xs font-semibold text-game-secondary">
          {t('room.nowHost')}
        </p>
      )}
      {room.is_host ? (
        <button
          type="button"
          disabled={!canStart || busy}
          onClick={onStart}
          className="h-12 px-8 rounded-full shadow-lg bg-game-secondary text-white font-semibold hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {canStart ? t('room.start') : t('room.waitingForPlayers')}
        </button>
      ) : (
        <p className="text-sm font-semibold animate-pulse">{t('room.waitingForHost')}</p>
      )}
      {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{t(error)}</p>}
      <button type="button" onClick={onLeave} className="text-xs text-game-muted underline hover:text-red-600">
        {room.is_host && room.member_count <= 1 ? t('room.closeRoom') : t('room.leave')}
      </button>
    </div>
  )
}
