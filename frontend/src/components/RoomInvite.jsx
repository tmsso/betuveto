import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * ROADMAP 7.2.5 — shown when the page was opened from an invite link (`?room=CODE`): a
 * name field and Join, in place of the pre-game board. "Not now" just dismisses it.
 */
export default function RoomInvite({ code, displayName, busy, error, onJoin, onDismiss }) {
  const { t } = useTranslation()
  const [name, setName] = useState(displayName ?? '')
  const trimmed = name.trim()
  return (
    <div className="mb-6 flex flex-col items-center gap-3 text-center" data-testid="room-invite">
      <p className="text-lg font-bold">{t('room.invited', { code })}</p>
      <label className="flex items-center gap-2 text-sm">
        <span className="text-game-muted font-semibold">{t('room.nameLabel')}</span>
        <input
          type="text"
          value={name}
          maxLength={20}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('room.namePlaceholder')}
          className="border-2 border-game-border rounded-lg px-2 py-1 font-bold text-game-primary bg-game-surface focus:outline-none focus:ring-2 focus:ring-game-secondary w-36"
        />
      </label>
      <button
        type="button"
        disabled={busy || !trimmed}
        onClick={() => onJoin(code, trimmed)}
        className="h-12 px-8 rounded-full shadow-lg bg-game-secondary text-white font-semibold hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {t('room.join')}
      </button>
      {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{t(error)}</p>}
      <button type="button" onClick={onDismiss} className="text-xs text-game-muted underline">
        {t('room.notNow')}
      </button>
    </div>
  )
}
