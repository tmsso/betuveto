import { useCallback, useEffect, useState } from 'react'
import AdminWordsPanel from './AdminWordsPanel'

// Interim admin auth (ROADMAP 5.1): a shared token, not a real per-admin login — see
// lib/admin.ts for why. Stored client-side only in this browser's localStorage; never
// sent anywhere except as this app's own x-admin-token header.
const TOKEN_KEY = 'bv_admin_token'

export default function AdminApp() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '')
  const [tokenInput, setTokenInput] = useState('')
  const [tab, setTab] = useState('queue')
  const [queue, setQueue] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  // Keys of rows with a mutation in flight (e.g. "report-12", "suggestion-7"), so only
  // that row's buttons disable rather than the whole page freezing during one request.
  const [pendingRows, setPendingRows] = useState(() => new Set())

  const loadQueue = useCallback(async (activeToken) => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/v1/admin/queue', {
        headers: { 'x-admin-token': activeToken },
      })
      if (response.status === 401) {
        localStorage.removeItem(TOKEN_KEY)
        setToken('')
        setError('Érvénytelen token.')
        return
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setQueue(await response.json())
    } catch (err) {
      setError(err.message || 'Hiba történt a lekéréskor.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (token && tab === 'queue' && !queue) loadQueue(token)
  }, [token, tab, queue, loadQueue])

  const runMutation = useCallback(async (rowKey, path, decision) => {
    setPendingRows((prev) => new Set(prev).add(rowKey))
    setError(null)
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'x-admin-token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      })
      if (response.status === 401) {
        localStorage.removeItem(TOKEN_KEY)
        setToken('')
        setError('Érvénytelen token.')
        return
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      await loadQueue(token)
    } catch (err) {
      setError(err.message || 'Hiba történt a művelet során.')
    } finally {
      setPendingRows((prev) => {
        const next = new Set(prev)
        next.delete(rowKey)
        return next
      })
    }
  }, [token, loadQueue])

  const handleResolveReport = (wordId, decision) =>
    runMutation(`report-${wordId}`, `/api/v1/admin/reports/${wordId}/resolve`, decision)

  const handleResolveSuggestion = (suggestionId, decision) =>
    runMutation(`suggestion-${suggestionId}`, `/api/v1/admin/suggestions/${suggestionId}/resolve`, decision)

  const handleTokenSubmit = (e) => {
    e.preventDefault()
    const trimmed = tokenInput.trim()
    if (!trimmed) return
    localStorage.setItem(TOKEN_KEY, trimmed)
    setToken(trimmed)
    setTokenInput('')
  }

  const handleLogout = () => {
    localStorage.removeItem(TOKEN_KEY)
    setToken('')
    setQueue(null)
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-game-paper p-6">
        <form
          onSubmit={handleTokenSubmit}
          className="bg-white border-4 border-game-border rounded-lg p-6 w-full max-w-sm shadow-lg"
        >
          <h1 className="text-xl font-extrabold text-game-primary mb-4">Betűvető admin</h1>
          <input
            type="password"
            aria-label="Admin token"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="Admin token"
            className="w-full border-2 border-game-border rounded p-2 mb-4 focus:outline-none focus:ring-2 focus:ring-game-secondary"
            autoFocus
          />
          <button
            type="submit"
            className="w-full bg-game-secondary text-white font-semibold rounded p-2 hover:bg-blue-600 transition-colors"
          >
            Belépés
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-game-paper p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-extrabold text-game-primary">Betűvető admin — ellenőrzési sor</h1>
          <button
            onClick={handleLogout}
            className="text-sm underline text-game-primary/70 hover:text-game-primary"
          >
            Kijelentkezés
          </button>
        </div>

        <div className="flex gap-4 mb-6 border-b-2 border-game-border">
          {[
            ['queue', 'Ellenőrzési sor'],
            ['words', 'Szavak'],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`pb-2 px-1 font-semibold ${
                tab === id
                  ? 'text-game-primary border-b-2 border-game-primary -mb-0.5'
                  : 'text-game-primary/50 hover:text-game-primary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'words' && <AdminWordsPanel token={token} onAuthError={handleLogout} />}

        {tab === 'queue' && (
        <>
        {loading && <p className="text-sm text-game-primary/70">Betöltés...</p>}
        {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

        {queue && (
          <>
            <section className="mb-8">
              <h2 className="text-lg font-bold mb-2">Bejelentett szavak ({queue.reports.length})</h2>
              {queue.reports.length === 0 ? (
                <p className="text-sm text-game-primary/60">Nincs nyitott bejelentés.</p>
              ) : (
                <table className="w-full text-sm border-collapse bg-white rounded-lg overflow-hidden shadow">
                  <thead>
                    <tr className="text-left border-b-2 border-game-border bg-blue-50">
                      <th className="py-2 px-2">Szó</th>
                      <th className="py-2 px-2">Szólista</th>
                      <th className="py-2 px-2">Aktív?</th>
                      <th className="py-2 px-2">Első bejelentés</th>
                      <th className="py-2 px-2">Döntés</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queue.reports.map((r) => {
                      const busy = pendingRows.has(`report-${r.word_id}`)
                      return (
                        <tr key={r.word_id} className="border-b border-game-border/40">
                          <td className="py-2 px-2 font-semibold">
                            {r.word}
                            {r.report_count > 1 && (
                              <span className="ml-1 text-xs font-normal text-game-primary/50">
                                ({r.report_count}x bejelentve)
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-2">{r.wordlist}</td>
                          <td className="py-2 px-2">{r.active ? 'igen' : 'nem (kikapcsolva)'}</td>
                          <td className="py-2 px-2">{new Date(r.first_reported_at).toLocaleString('hu-HU')}</td>
                          <td className="py-2 px-2 whitespace-nowrap">
                            <button
                              onClick={() => handleResolveReport(r.word_id, 'accept')}
                              disabled={busy}
                              title="A bejelentés jogos: a szó törlődik a listáról"
                              className="text-red-600 underline font-semibold hover:text-red-800 disabled:opacity-40 mr-3"
                            >
                              Törlöm (rossz szó)
                            </button>
                            <button
                              onClick={() => handleResolveReport(r.word_id, 'reject')}
                              disabled={busy}
                              title="A bejelentés alaptalan: a szó marad/visszaáll"
                              className="text-green-700 underline font-semibold hover:text-green-900 disabled:opacity-40"
                            >
                              Megtartom
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </section>

            <section>
              <h2 className="text-lg font-bold mb-2">Javasolt szavak ({queue.suggestions.length})</h2>
              {queue.suggestions.length === 0 ? (
                <p className="text-sm text-game-primary/60">Nincs nyitott javaslat.</p>
              ) : (
                <table className="w-full text-sm border-collapse bg-white rounded-lg overflow-hidden shadow">
                  <thead>
                    <tr className="text-left border-b-2 border-game-border bg-blue-50">
                      <th className="py-2 px-2">Szó</th>
                      <th className="py-2 px-2">Szólista</th>
                      <th className="py-2 px-2">Javasolta</th>
                      <th className="py-2 px-2">Dátum</th>
                      <th className="py-2 px-2">Művelet</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queue.suggestions.map((s) => {
                      const busy = pendingRows.has(`suggestion-${s.id}`)
                      return (
                        <tr key={s.id} className="border-b border-game-border/40">
                          <td className="py-2 px-2 font-semibold">{s.word}</td>
                          <td className="py-2 px-2">{s.wordlist}</td>
                          <td className="py-2 px-2">{s.suggested_by || 'névtelen'}</td>
                          <td className="py-2 px-2">{new Date(s.created_at).toLocaleString('hu-HU')}</td>
                          <td className="py-2 px-2 whitespace-nowrap">
                            <button
                              onClick={() => handleResolveSuggestion(s.id, 'approve')}
                              disabled={busy}
                              className="text-green-700 underline hover:text-green-900 disabled:opacity-40 mr-3"
                            >
                              Jóváhagyom
                            </button>
                            <button
                              onClick={() => handleResolveSuggestion(s.id, 'reject')}
                              disabled={busy}
                              className="text-red-600 underline hover:text-red-800 disabled:opacity-40"
                            >
                              Elutasítom
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}
        </>
        )}
      </div>
    </div>
  )
}
