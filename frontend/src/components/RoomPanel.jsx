import { useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * ROADMAP 7.2.5 — "play with friends" entry point inside <SettingsPanel> (the DailyPanel
 * pattern). A display name is required for rooms (docs/multiplayer.md §1). Since the owner
 * review of 2026-11-08 there is no second name field here: rooms use the Settings
 * "Megjelenített név" just above, and create/join stay disabled until it is set. Creating
 * a room uses the current length / wordlist selection; mode, co-op variant and the reveal
 * toggle are fixed at creation.
 */
export default function RoomPanel({ displayName, busy, error, inRoom, onCreate, onJoin }) {
  const { t } = useTranslation()
  const [mode, setMode] = useState('coop')
  // ROADMAP 15.1: the co-op variant. Only offered for co-op; the server ignores it for versus.
  const [visibility, setVisibility] = useState('private')
  const [code, setCode] = useState('')
  // Off by default (owner review 2026-11-08): the words nobody found stay hidden.
  const [revealWords, setRevealWords] = useState(false)
  const name = (displayName ?? '').trim()
  const nameMissing = name.length === 0

  const inputClass =
    'border-2 border-game-border rounded-lg px-2 py-1 font-bold text-game-primary bg-game-surface focus:outline-none focus:ring-2 focus:ring-game-secondary'
  const buttonClass =
    'px-3 py-1.5 rounded-lg bg-game-button text-game-on-secondary text-sm font-semibold hover:bg-game-button-hover disabled:opacity-50 disabled:cursor-not-allowed'

  return (
    <section aria-labelledby="room-panel-title" className="flex flex-col gap-3">
      <h3 id="room-panel-title" className="text-xs font-bold uppercase tracking-wide text-game-muted">
        {t('room.panelTitle')}
      </h3>
      {inRoom ? (
        <p className="text-sm text-game-muted">{t('room.alreadyInRoom')}</p>
      ) : (
        <>
          {nameMissing && <p className="text-xs text-game-error">{t('room.nameRequired')}</p>}

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
          {mode === 'coop' && (
            <fieldset className="flex flex-col gap-1.5 text-sm">
              <legend className="text-game-muted font-semibold mb-1">{t('room.visibilityLabel')}</legend>
              {['private', 'shared'].map((value) => (
                <label key={value} className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="room-visibility"
                    value={value}
                    checked={visibility === value}
                    onChange={() => setVisibility(value)}
                    className="mt-1 accent-game-secondary"
                  />
                  <span>
                    <span className="font-semibold">{t(`room.visibility.${value}.name`)}</span>
                    <span className="block text-xs text-game-muted">{t(`room.visibility.${value}.explain`)}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          <label className="flex items-start gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={revealWords}
              onChange={(e) => setRevealWords(e.target.checked)}
              className="mt-1 accent-game-secondary"
            />
            <span>
              <span className="font-semibold">{t('room.revealWords.name')}</span>
              <span className="block text-xs text-game-muted">{t('room.revealWords.explain')}</span>
            </span>
          </label>
          <button type="button" disabled={busy || nameMissing} onClick={() => onCreate(name, mode, mode === 'coop' ? visibility : undefined, revealWords)} className={buttonClass}>
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
              disabled={busy || nameMissing || code.length !== 6}
              onClick={() => onJoin(code, name)}
              className={buttonClass}
            >
              {t('room.join')}
            </button>
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-xs text-game-error">{t(error)}</p>
      )}
    </section>
  )
}
