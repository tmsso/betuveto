import { useState } from 'react'
import { useTranslation } from 'react-i18next'

const NAME_MAX = 20 // mirrors lib/players.ts's DISPLAY_NAME_MAX_LENGTH

/**
 * ROADMAP 7.2.5 — "play with friends" entry point inside <SettingsPanel> (the DailyPanel
 * pattern). A display name is required for rooms (docs/multiplayer.md §1), so the field
 * is prefilled from the player's saved name and sent with create/join. Creating a room
 * uses the current length / wordlist selection; the mode is fixed at creation.
 */
export default function RoomPanel({ displayName, busy, error, inRoom, onCreate, onJoin }) {
  const { t } = useTranslation()
  const [name, setName] = useState(displayName ?? '')
  const [mode, setMode] = useState('coop')
  const [code, setCode] = useState('')
  const [nameMissing, setNameMissing] = useState(false)

  const withName = (action) => {
    const trimmed = name.trim()
    if (!trimmed) {
      setNameMissing(true)
      return
    }
    setNameMissing(false)
    action(trimmed)
  }

  const inputClass =
    'border-2 border-game-border rounded-lg px-2 py-1 font-bold text-game-primary bg-game-surface focus:outline-none focus:ring-2 focus:ring-game-secondary'
  const buttonClass =
    'px-3 py-1.5 rounded-lg bg-game-secondary text-white text-sm font-semibold hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed'

  return (
    <section aria-labelledby="room-panel-title" className="flex flex-col gap-3">
      <h3 id="room-panel-title" className="text-xs font-bold uppercase tracking-wide text-game-muted">
        {t('room.panelTitle')}
      </h3>
      {inRoom ? (
        <p className="text-sm text-game-muted">{t('room.alreadyInRoom')}</p>
      ) : (
        <>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="text-game-muted font-semibold">{t('room.nameLabel')}</span>
            <input
              type="text"
              value={name}
              maxLength={NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('room.namePlaceholder')}
              className={`${inputClass} w-32`}
            />
          </label>
          {nameMissing && <p className="text-xs text-red-600 dark:text-red-400 -mt-2">{t('room.nameRequired')}</p>}

          <fieldset className="flex flex-col gap-1.5 text-sm">
            <legend className="text-game-muted font-semibold mb-1">{t('room.modeLabel')}</legend>
            {['coop', 'versus'].map((value) => (
              <label key={value} className="flex items-start gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="room-mode"
                  value={value}
                  checked={mode === value}
                  onChange={() => setMode(value)}
                  className="mt-1 accent-game-secondary"
                />
                <span>
                  <span className="font-semibold">{t(`room.mode.${value}.name`)}</span>
                  <span className="block text-xs text-game-muted">{t(`room.mode.${value}.explain`)}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <button type="button" disabled={busy} onClick={() => withName((n) => onCreate(n, mode))} className={buttonClass}>
            {t('room.create')}
          </button>

          <div className="flex items-center gap-2 pt-2 border-t border-game-border">
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
              placeholder={t('room.codePlaceholder')}
              aria-label={t('room.codeLabel')}
              className={`${inputClass} w-28 tracking-widest uppercase`}
            />
            <button
              type="button"
              disabled={busy || code.length !== 6}
              onClick={() => withName((n) => onJoin(code, n))}
              className={buttonClass}
            >
              {t('room.join')}
            </button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">{t(error)}</p>
      )}
    </section>
  )
}
