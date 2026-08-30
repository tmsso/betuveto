import { useCallback, useEffect, useState } from 'react'
import { useAdminT } from './admin/adminI18n'

// Admin-editable gameplay knobs (ROADMAP 5.2 item 2). Edits land in the `config` table
// and take effect on other warm serverless instances within ~30s (lib/config.ts's cache
// TTL) — not instantly everywhere, which is why the panel shows a small note about that
// rather than implying an immediate global effect.
//
// ROADMAP Batch 10 item 14 — the second section toggles player-facing control visibility
// (hiding a control also pins its value server-side in game/start, see lib/game.ts).
// Labels for both come from the admin i18n catalog (`config.<key>` / `ui.<key>`).

const UI_WORDLISTS = [
  { code: 'hu', label: 'Magyar' },
  { code: 'en', label: 'English' },
]

export default function AdminConfigPanel({ authHeaders, onAuthError }) {
  const { t } = useAdminT()
  const [config, setConfig] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [drafts, setDrafts] = useState({})
  const [pendingKeys, setPendingKeys] = useState(() => new Set())
  const [savedKey, setSavedKey] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/v1/admin/config', {
        headers: authHeaders,
      })
      if (response.status === 401) {
        onAuthError()
        return
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = await response.json()
      setConfig(body.config)
      setDrafts(Object.fromEntries(body.config.map((row) => [row.key, String(row.value)])))
    } catch (err) {
      setError(err.message || t('err.load'))
    } finally {
      setLoading(false)
    }
  }, [authHeaders, onAuthError, t])

  useEffect(() => {
    load()
  }, [load])

  const save = async (key) => {
    const raw = drafts[key]
    const value = Number(raw)
    if (!Number.isFinite(value)) {
      setError(t('config.notNumber', { label: t(`config.${key}`) }))
      return
    }
    setPendingKeys((prev) => new Set(prev).add(key))
    setError(null)
    try {
      const response = await fetch(`/api/v1/admin/config/${key}`, {
        method: 'PATCH',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      })
      if (response.status === 401) {
        onAuthError()
        return
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.detail || `HTTP ${response.status}`)
      }
      setSavedKey(key)
      setTimeout(() => setSavedKey((current) => (current === key ? null : current)), 2000)
      await load()
    } catch (err) {
      setError(err.message || t('err.save'))
    } finally {
      setPendingKeys((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  return (
    <>
    <section className="mb-10">
      <p className="text-sm text-game-primary/60 mb-4">{t('config.propagationNote')}</p>

      {loading && <p className="text-sm text-game-primary/70">{t('common.loading')}</p>}
      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {config && (
        <table className="w-full text-sm border-collapse bg-white rounded-lg overflow-hidden shadow">
          <thead>
            <tr className="text-left border-b-2 border-game-border bg-blue-50">
              <th className="py-2 px-2">{t('common.setting')}</th>
              <th className="py-2 px-2">{t('common.value')}</th>
              <th className="py-2 px-2">{t('common.default')}</th>
              <th className="py-2 px-2">{t('common.action')}</th>
            </tr>
          </thead>
          <tbody>
            {config.map((row) => {
              const busy = pendingKeys.has(row.key)
              return (
                <tr key={row.key} className="border-b border-game-border/40">
                  <td className="py-2 px-2 font-semibold">{t(`config.${row.key}`)}</td>
                  <td className="py-2 px-2">
                    <input
                      type="number"
                      value={drafts[row.key] ?? ''}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [row.key]: e.target.value }))}
                      className="border-2 border-game-border rounded p-1 w-24"
                    />
                  </td>
                  <td className="py-2 px-2 text-game-primary/50">{row.default}</td>
                  <td className="py-2 px-2 whitespace-nowrap">
                    <button
                      onClick={() => save(row.key)}
                      disabled={busy || drafts[row.key] === String(row.value)}
                      className="text-game-secondary underline font-semibold hover:text-blue-700 disabled:opacity-40"
                    >
                      {t('common.save')}
                    </button>
                    {savedKey === row.key && (
                      <span className="ml-2 text-green-700">{t('common.saved')}</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
    <UiVisibilitySection authHeaders={authHeaders} onAuthError={onAuthError} />
    </>
  )
}

// ROADMAP Batch 10 item 14 — toggle which start-screen controls players see. Changes
// apply immediately (no draft + save step): each is a single boolean/enum, and the same
// ~30s cache-propagation caveat as the table above still holds.
function UiVisibilitySection({ authHeaders, onAuthError }) {
  const { t } = useAdminT()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)
  const [savingKey, setSavingKey] = useState(null)
  const [savedKey, setSavedKey] = useState(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const response = await fetch('/api/v1/admin/ui-config', { headers: authHeaders })
      if (response.status === 401) {
        onAuthError()
        return
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setRows((await response.json()).config)
    } catch (err) {
      setError(err.message || t('err.load'))
    }
  }, [authHeaders, onAuthError, t])

  useEffect(() => {
    load()
  }, [load])

  const patch = async (key, value) => {
    setSavingKey(key)
    setError(null)
    try {
      const response = await fetch(`/api/v1/admin/ui-config/${key}`, {
        method: 'PATCH',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value }),
      })
      if (response.status === 401) {
        onAuthError()
        return
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.detail || `HTTP ${response.status}`)
      }
      setSavedKey(key)
      setTimeout(() => setSavedKey((current) => (current === key ? null : current)), 2000)
      await load()
    } catch (err) {
      setError(err.message || t('err.save'))
    } finally {
      setSavingKey(null)
    }
  }

  const valueOf = (key) => rows?.find((r) => r.key === key)?.value

  return (
    <section>
      <h3 className="text-lg font-bold mb-1">{t('ui.sectionTitle')}</h3>
      <p className="text-sm text-game-primary/60 mb-4">{t('ui.sectionNote')}</p>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
      {!rows && <p className="text-sm text-game-primary/70">{t('common.loading')}</p>}

      {rows && (
        <table className="w-full text-sm border-collapse bg-white rounded-lg overflow-hidden shadow">
          <tbody>
            {rows.map((row) => {
              const busy = savingKey === row.key
              return (
                <tr key={row.key} className="border-b border-game-border/40">
                  <td className="py-2 px-2 font-semibold">{t(`ui.${row.key}`)}</td>
                  <td className="py-2 px-2">
                    {typeof row.value === 'boolean' && (
                      <label className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={row.value}
                          disabled={busy}
                          onChange={(e) => patch(row.key, e.target.checked)}
                          className="h-4 w-4"
                        />
                        <span>{row.value ? t('ui.visible') : t('ui.hidden')}</span>
                      </label>
                    )}
                    {row.key === 'default_length' && (
                      <select
                        value={valueOf('default_length') ?? 7}
                        disabled={busy}
                        onChange={(e) => patch('default_length', Number(e.target.value))}
                        className="border-2 border-game-border rounded p-1"
                      >
                        {[5, 6, 7, 8, 9, 10].map((n) => (
                          <option key={n} value={n}>{t('ui.lengthOption', { n })}</option>
                        ))}
                      </select>
                    )}
                    {row.key === 'default_wordlist' && (
                      <select
                        value={valueOf('default_wordlist') ?? 'hu'}
                        disabled={busy}
                        onChange={(e) => patch('default_wordlist', e.target.value)}
                        className="border-2 border-game-border rounded p-1"
                      >
                        {UI_WORDLISTS.map(({ code, label }) => (
                          <option key={code} value={code}>{label}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="py-2 px-2 text-game-primary/50">
                    {typeof row.default === 'boolean'
                      ? row.default ? t('ui.visible') : t('ui.hidden')
                      : String(row.default)}
                  </td>
                  <td className="py-2 px-2">
                    {savedKey === row.key && <span className="text-green-700">{t('common.saved')}</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </section>
  )
}
