import { useCallback, useEffect, useState } from 'react'

// Admin-editable gameplay knobs (ROADMAP 5.2 item 2). Edits land in the `config` table
// and take effect on other warm serverless instances within ~30s (lib/config.ts's cache
// TTL) — not instantly everywhere, which is why the panel shows a small note about that
// rather than implying an immediate global effect.

// ROADMAP Batch 10 item 14 — player-facing control visibility. Hiding a control also
// pins its value server-side in game/start (see lib/game.ts), so a hidden length/wordlist
// selector still yields a valid game. Labels stay Hungarian for now, the same as the rest
// of the admin panel — the admin-shell i18n pass (item 14, follow-up PR) translates all
// of them together.
const UI_LABELS = {
  show_length_selector: 'Szóhossz-választó látható',
  show_wordlist_selector: 'Szótárválasztó látható',
  show_easy_mode: 'Könnyű mód kapcsoló látható',
  default_length: 'Rögzített szóhossz (ha a választó rejtve van)',
  default_wordlist: 'Rögzített szótár (ha a választó rejtve van)',
}
const UI_WORDLISTS = [
  { code: 'hu', label: 'Magyar' },
  { code: 'en', label: 'English' },
]

const LABELS = {
  hint_cost: 'Segítség ára (pont)',
  completion_bonus_multiplier: 'Teljesítési bónusz szorzó (pont/másodperc)',
  guess_rate_limit_per_second: 'Tippelési sebességkorlát (helyes tipp/mp)',
  min_word_length: 'Legrövidebb elfogadott szó (betű)',
  timer_base_seconds: 'Alap időkeret (másodperc)',
  timer_seconds_per_extra_length: 'Extra idő betűnként a minimum fölött (másodperc)',
}

export default function AdminConfigPanel({ authHeaders, onAuthError }) {
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
      setError(err.message || 'Hiba történt a betöltéskor.')
    } finally {
      setLoading(false)
    }
  }, [authHeaders, onAuthError])

  useEffect(() => {
    load()
  }, [load])

  const save = async (key) => {
    const raw = drafts[key]
    const value = Number(raw)
    if (!Number.isFinite(value)) {
      setError(`${LABELS[key] || key}: a megadott érték nem szám.`)
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
      setError(err.message || 'Hiba történt a mentéskor.')
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
      <p className="text-sm text-game-primary/60 mb-4">
        A módosítások kb. 30 másodperc alatt érnek el minden szervert — nem azonnal
        mindenhol, mert a beállításokat gyakori lekérdezés helyett gyorsítótárazzuk.
      </p>

      {loading && <p className="text-sm text-game-primary/70">Betöltés...</p>}
      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {config && (
        <table className="w-full text-sm border-collapse bg-white rounded-lg overflow-hidden shadow">
          <thead>
            <tr className="text-left border-b-2 border-game-border bg-blue-50">
              <th className="py-2 px-2">Beállítás</th>
              <th className="py-2 px-2">Érték</th>
              <th className="py-2 px-2">Alapérték</th>
              <th className="py-2 px-2">Művelet</th>
            </tr>
          </thead>
          <tbody>
            {config.map((row) => {
              const busy = pendingKeys.has(row.key)
              return (
                <tr key={row.key} className="border-b border-game-border/40">
                  <td className="py-2 px-2 font-semibold">{LABELS[row.key] || row.key}</td>
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
                      Mentés
                    </button>
                    {savedKey === row.key && (
                      <span className="ml-2 text-green-700">Mentve.</span>
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
// apply immediately (no draft + Mentés step): each is a single boolean/enum, and the same
// ~30s cache-propagation caveat as the table above still holds.
function UiVisibilitySection({ authHeaders, onAuthError }) {
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
      setError(err.message || 'Hiba történt a betöltéskor.')
    }
  }, [authHeaders, onAuthError])

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
      setError(err.message || 'Hiba történt a mentéskor.')
    } finally {
      setSavingKey(null)
    }
  }

  const valueOf = (key) => rows?.find((r) => r.key === key)?.value

  return (
    <section>
      <h3 className="text-lg font-bold mb-1">Játékos-felület elemei</h3>
      <p className="text-sm text-game-primary/60 mb-4">
        Egy elrejtett vezérlő a szerveren is rögzítve lesz (a lenti alapértékre), tehát a
        játék így is indítható. A módosítás ugyanúgy kb. 30 másodperc alatt terjed szét.
      </p>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
      {!rows && <p className="text-sm text-game-primary/70">Betöltés...</p>}

      {rows && (
        <table className="w-full text-sm border-collapse bg-white rounded-lg overflow-hidden shadow">
          <tbody>
            {rows.map((row) => {
              const busy = savingKey === row.key
              return (
                <tr key={row.key} className="border-b border-game-border/40">
                  <td className="py-2 px-2 font-semibold">{UI_LABELS[row.key] || row.key}</td>
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
                        <span>{row.value ? 'Látható' : 'Rejtve'}</span>
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
                          <option key={n} value={n}>{n} betű</option>
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
                      ? row.default ? 'Látható' : 'Rejtve'
                      : String(row.default)}
                  </td>
                  <td className="py-2 px-2">
                    {savedKey === row.key && <span className="text-green-700">Mentve.</span>}
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
