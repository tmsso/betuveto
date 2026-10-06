import { useCallback, useState } from 'react'
import { useAdminT } from './admin/adminI18n'

// Word maintenance (ROADMAP 5.2 item 1): search the wordlist, fix a typo in place, or
// remove a row outright. Toggling active/inactive already lives in the queue tab
// (accept/reject/reactivate) — this tab is only for the word text itself.
export default function AdminWordsPanel({ authHeaders, onAuthError }) {
  const { t } = useAdminT()
  const [query, setQuery] = useState('')
  const [words, setWords] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editValue, setEditValue] = useState('')
  const [pendingIds, setPendingIds] = useState(() => new Set())
  // ROADMAP 13.5: multi-select + one action for every selected word.
  const [selected, setSelected] = useState(() => new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkResult, setBulkResult] = useState(null)
  // ROADMAP 13.6: "select suspicious" — the last scan's thresholds and totals. While set,
  // the table shows the scan's words (pre-ticked) and a reasons column.
  const [suspicionParams, setSuspicionParams] = useState({ min_length: 3, max_vowel_run: 3, max_consonant_run: 4 })
  const [suspicious, setSuspicious] = useState(null)

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
      setSelected(new Set())
      setSuspicious(null)
    } catch (err) {
      setError(err.message || t('err.search'))
    } finally {
      setLoading(false)
    }
  }, [authHeaders, onAuthError, t])

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
      setError(err.message || t('err.save'))
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }

  const deleteWord = async (word) => {
    if (!window.confirm(t('words.confirmDelete', { word: word.word }))) return
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
      setError(err.message || t('err.delete'))
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev)
        next.delete(word.id)
        return next
      })
    }
  }

  const runSuspiciousScan = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams(Object.entries(suspicionParams).map(([k, v]) => [k, String(v)]))
      const response = await fetch(`/api/v1/admin/words/suspicious?${params}`, { headers: authHeaders })
      if (response.status === 401) {
        onAuthError()
        return
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = await response.json()
      setWords(body.words)
      // Pre-ticked for review, never acted on: the admin still picks an action below.
      setSelected(new Set(body.words.map((w) => w.id)))
      setSuspicious({ total: body.total_flagged, reasonCounts: body.reason_counts ?? {} })
    } catch (err) {
      setError(err.message || t('err.search'))
    } finally {
      setLoading(false)
    }
  }, [suspicionParams, authHeaders, onAuthError, t])

  const toggleSelected = (id) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const runBulk = async (action, label) => {
    const ids = [...selected]
    if (ids.length === 0) return
    if (!window.confirm(t('words.confirmBulk', { action: label, count: ids.length }))) return
    setBulkBusy(true)
    setError(null)
    setBulkResult(null)
    try {
      const response = await fetch('/api/v1/admin/words/bulk', {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ids }),
      })
      if (response.status === 401) {
        onAuthError()
        return
      }
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.detail || `HTTP ${response.status}`)
      setBulkResult(body)
      if (suspicious) await runSuspiciousScan()
      else await runSearch(query)
    } catch (err) {
      setError(err.message || t('err.save'))
    } finally {
      setBulkBusy(false)
    }
  }

  const activeTargetSkips = bulkResult?.skipped?.filter((s) => s.reason === 'active_target') ?? []

  return (
    <section>
      <form onSubmit={handleSearchSubmit} className="mb-4 flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('words.searchPlaceholder')}
          className="flex-1 border-2 border-game-border rounded p-2 focus:outline-none focus:ring-2 focus:ring-game-secondary"
        />
        <button
          type="submit"
          disabled={loading}
          className="bg-game-secondary text-white font-semibold rounded px-4 py-2 hover:bg-blue-600 transition-colors disabled:opacity-40"
        >
          {t('common.search')}
        </button>
      </form>

      <div className="mb-4 flex flex-wrap items-end gap-3 text-sm">
        {[
          ['min_length', t('words.suspiciousMinLength')],
          ['max_vowel_run', t('words.suspiciousMaxVowels')],
          ['max_consonant_run', t('words.suspiciousMaxConsonants')],
        ].map(([key, label]) => (
          <label key={key} className="flex flex-col gap-1">
            <span className="text-xs text-game-primary/70">{label}</span>
            <input
              type="number"
              min={1}
              max={key === 'min_length' ? 15 : 10}
              value={suspicionParams[key]}
              onChange={(e) => setSuspicionParams((p) => ({ ...p, [key]: Number(e.target.value) }))}
              className="w-20 border-2 border-game-border rounded p-1"
            />
          </label>
        ))}
        <button
          type="button"
          disabled={loading}
          onClick={runSuspiciousScan}
          className="bg-amber-600 text-white font-semibold rounded px-4 py-2 hover:bg-amber-700 disabled:opacity-40"
        >
          {t('words.suspiciousButton')}
        </button>
        <span className="basis-full text-xs text-game-primary/60">{t('words.suspiciousHint')}</span>
        {suspicious && words && (
          <span className="basis-full text-xs font-semibold">
            {t('words.suspiciousTotal', { shown: words.length, total: suspicious.total })}{' '}
            {Object.entries(suspicious.reasonCounts).map(([r, n]) => `${t(`reason.${r}`)}: ${n}`).join(' · ')}
          </span>
        )}
      </div>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
      {loading && <p className="text-sm text-game-primary/70">{t('common.loading')}</p>}

      {bulkResult && (
        <div className="text-sm mb-4 text-game-primary/80" role="status">
          <p>{t('words.bulkResult', {
            changed: bulkResult.changed.length,
            unchanged: bulkResult.unchanged_count,
            skipped: bulkResult.skipped.length,
          })}</p>
          {activeTargetSkips.length > 0 && (
            <p>{t('words.skippedActiveTarget', { words: activeTargetSkips.map((s) => s.word).join(', ') })}</p>
          )}
        </div>
      )}

      {words && words.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
          <button type="button" onClick={() => setSelected(new Set(words.map((w) => w.id)))} className="underline text-game-secondary">
            {t('words.selectAll')}
          </button>
          <button type="button" onClick={() => setSelected(new Set())} className="underline text-game-secondary">
            {t('words.selectNone')}
          </button>
          <span className="text-game-primary/70">{t('words.bulkSelected', { count: selected.size })}</span>
          {[
            ['inactivate', t('words.bulkInactivate'), 'bg-amber-600 hover:bg-amber-700'],
            ['reactivate', t('words.bulkReactivate'), 'bg-green-700 hover:bg-green-800'],
            ['delete', t('words.bulkDelete'), 'bg-red-600 hover:bg-red-700'],
          ].map(([action, label, colour]) => (
            <button
              key={action}
              type="button"
              disabled={bulkBusy || selected.size === 0}
              onClick={() => runBulk(action, label)}
              className={`${colour} text-white font-semibold rounded px-3 py-1 disabled:opacity-40`}
            >
              {label}
            </button>
          ))}
          <span className="basis-full text-xs text-game-primary/60">{t('words.selectAllHint')}</span>
        </div>
      )}

      {words && (
        words.length === 0 ? (
          <p className="text-sm text-game-primary/60">{t('common.noResults')}</p>
        ) : (
          <table className="w-full text-sm border-collapse bg-white rounded-lg overflow-hidden shadow">
            <thead>
              <tr className="text-left border-b-2 border-game-border bg-blue-50">
                <th className="py-2 px-2 w-8"><span className="sr-only">{t('words.bulkSelected', { count: selected.size })}</span></th>
                <th className="py-2 px-2">{t('common.word')}</th>
                <th className="py-2 px-2">{t('common.activeQ')}</th>
                <th className="py-2 px-2">{t('words.source')}</th>
                {suspicious && <th className="py-2 px-2">{t('words.reasons')}</th>}
                <th className="py-2 px-2">{t('common.action')}</th>
              </tr>
            </thead>
            <tbody>
              {words.map((w) => {
                const busy = pendingIds.has(w.id)
                const editing = editingId === w.id
                return (
                  <tr key={w.id} className="border-b border-game-border/40">
                    <td className="py-2 px-2">
                      <input
                        type="checkbox"
                        checked={selected.has(w.id)}
                        onChange={() => toggleSelected(w.id)}
                        aria-label={t('words.selectRow', { word: w.word })}
                      />
                    </td>
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
                    <td className="py-2 px-2">{w.active ? t('common.yes') : t('common.no')}</td>
                    <td className="py-2 px-2">{w.source === 'suggested' ? t('words.sourceSuggested') : t('words.sourceOriginal')}</td>
                    {suspicious && (
                      <td className="py-2 px-2 text-xs">{(w.reasons ?? []).map((r) => t(`reason.${r}`)).join(', ')}</td>
                    )}
                    <td className="py-2 px-2 whitespace-nowrap">
                      {editing ? (
                        <>
                          <button
                            onClick={() => saveEdit(w.id)}
                            disabled={busy}
                            className="text-green-700 underline font-semibold hover:text-green-900 disabled:opacity-40 mr-3"
                          >
                            {t('common.save')}
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            disabled={busy}
                            className="text-game-primary/60 underline hover:text-game-primary disabled:opacity-40"
                          >
                            {t('common.cancel')}
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => startEdit(w)}
                            disabled={busy}
                            className="text-game-secondary underline font-semibold hover:text-blue-700 disabled:opacity-40 mr-3"
                          >
                            {t('words.edit')}
                          </button>
                          <button
                            onClick={() => deleteWord(w)}
                            disabled={busy}
                            className="text-red-600 underline font-semibold hover:text-red-800 disabled:opacity-40"
                          >
                            {t('words.delete')}
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
