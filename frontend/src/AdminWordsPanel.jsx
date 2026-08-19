import { useCallback, useState } from 'react'

// Word maintenance (ROADMAP 5.2 item 1): search the wordlist, fix a typo in place, or
// remove a row outright. Toggling active/inactive already lives in the queue tab
// (accept/reject/reactivate) — this tab is only for the word text itself.
export default function AdminWordsPanel({ authHeaders, onAuthError }) {
  const [query, setQuery] = useState('')
  const [words, setWords] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [pendingIds, setPendingIds] = useState(() => new Set())

  const runSearch = useCallback(async (q) => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/v1/admin/words?q=${encodeURIComponent(q)}`, {
        headers: authHeaders,
      })
      if (response.status === 401) {
        onAuthError()
        return
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = await response.json()
      setWords(body.words)
    } catch (err) {
      setError(err.message || 'Hiba történt a keresés során.')
    } finally {
      setLoading(false)
    }
  }, [authHeaders, onAuthError])

  const handleSearchSubmit = (e) => {
    e.preventDefault()
    runSearch(query)
  }

  const startEdit = (word) => {
    setEditingId(word.id)
    setEditValue(word.word)
  }

  const saveEdit = async (id) => {
    setPendingIds((prev) => new Set(prev).add(id))
    setError(null)
    try {
      const response = await fetch(`/api/v1/admin/words/${id}`, {
        method: 'PATCH',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ word: editValue }),
      })
      if (response.status === 401) {
        onAuthError()
        return
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.detail || `HTTP ${response.status}`)
      }
      setEditingId(null)
      await runSearch(query)
    } catch (err) {
      setError(err.message || 'Hiba történt a mentéskor.')
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  const deleteWord = async (word) => {
    if (!window.confirm(`Biztosan törlöd: "${word.word}"?`)) return
    setPendingIds((prev) => new Set(prev).add(word.id))
    setError(null)
    try {
      const response = await fetch(`/api/v1/admin/words/${word.id}`, {
        method: 'DELETE',
        headers: authHeaders,
      })
      if (response.status === 401) {
        onAuthError()
        return
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.detail || `HTTP ${response.status}`)
      }
      await runSearch(query)
    } catch (err) {
      setError(err.message || 'Hiba történt a törléskor.')
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev)
        next.delete(word.id)
        return next
      })
    }
  }

  return (
    <section>
      <form onSubmit={handleSearchSubmit} className="mb-4 flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Keresés a szólistában..."
          className="flex-1 border-2 border-game-border rounded p-2 focus:outline-none focus:ring-2 focus:ring-game-secondary"
        />
        <button
          type="submit"
          disabled={loading}
          className="bg-game-secondary text-white font-semibold rounded px-4 py-2 hover:bg-blue-600 transition-colors disabled:opacity-40"
        >
          Keresés
        </button>
      </form>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
      {loading && <p className="text-sm text-game-primary/70">Betöltés...</p>}

      {words && (
        words.length === 0 ? (
          <p className="text-sm text-game-primary/60">Nincs találat.</p>
        ) : (
          <table className="w-full text-sm border-collapse bg-white rounded-lg overflow-hidden shadow">
            <thead>
              <tr className="text-left border-b-2 border-game-border bg-blue-50">
                <th className="py-2 px-2">Szó</th>
                <th className="py-2 px-2">Aktív?</th>
                <th className="py-2 px-2">Forrás</th>
                <th className="py-2 px-2">Művelet</th>
              </tr>
            </thead>
            <tbody>
              {words.map((w) => {
                const busy = pendingIds.has(w.id)
                const editing = editingId === w.id
                return (
                  <tr key={w.id} className="border-b border-game-border/40">
                    <td className="py-2 px-2 font-semibold">
                      {editing ? (
                        <input
                          type="text"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="border-2 border-game-border rounded p-1 w-full"
                          autoFocus
                        />
                      ) : (
                        w.word
                      )}
                    </td>
                    <td className="py-2 px-2">{w.active ? 'igen' : 'nem'}</td>
                    <td className="py-2 px-2">{w.source === 'suggested' ? 'javasolt' : 'eredeti'}</td>
                    <td className="py-2 px-2 whitespace-nowrap">
                      {editing ? (
                        <>
                          <button
                            onClick={() => saveEdit(w.id)}
                            disabled={busy}
                            className="text-green-700 underline font-semibold hover:text-green-900 disabled:opacity-40 mr-3"
                          >
                            Mentés
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            disabled={busy}
                            className="text-game-primary/60 underline hover:text-game-primary disabled:opacity-40"
                          >
                            Mégsem
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => startEdit(w)}
                            disabled={busy}
                            className="text-game-secondary underline font-semibold hover:text-blue-700 disabled:opacity-40 mr-3"
                          >
                            Szerkesztés
                          </button>
                          <button
                            onClick={() => deleteWord(w)}
                            disabled={busy}
                            className="text-red-600 underline font-semibold hover:text-red-800 disabled:opacity-40"
                          >
                            Törlés
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )
      )}
    </section>
  )
}
