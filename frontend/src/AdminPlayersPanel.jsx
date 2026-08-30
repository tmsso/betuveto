import { Fragment, useCallback, useState } from 'react'
import { adminLocale, useAdminT } from './admin/adminI18n'

// Player and leaderboard maintenance (ROADMAP 5.2 item 3). Merging duplicate players is
// deliberately not here — it's the same operation Batch 8's Google OAuth merge rule
// needs, and belongs with that design, not pre-empted here.
export default function AdminPlayersPanel({ authHeaders, onAuthError }) {
  const { lang, t } = useAdminT()
  const [playerQuery, setPlayerQuery] = useState('')
  const [players, setPlayers] = useState(null)
  const [editingPlayerId, setEditingPlayerId] = useState(null)
  const [nameDraft, setNameDraft] = useState('')

  const [entries, setEntries] = useState(null)
  const [entriesLoaded, setEntriesLoaded] = useState(false)

  const [error, setError] = useState(null)
  const [pendingIds, setPendingIds] = useState(() => new Set())

  // ROADMAP Batch 10 item 12 — drill-down into one game's full guess/hint timeline.
  // Expanded inline under its leaderboard row rather than a modal, matching this admin
  // shell's existing "no component library" convention.
  const [expandedGameId, setExpandedGameId] = useState(null)
  const [gameDetail, setGameDetail] = useState(null)

  const withAuthCheck = useCallback(async (response) => {
    if (response.status === 401) {
      onAuthError()
      return true
    }
    return false
  }, [onAuthError])

  const searchPlayers = useCallback(async (q) => {
    setError(null)
    try {
      const response = await fetch(`/api/v1/admin/players?q=${encodeURIComponent(q)}`, {
        headers: authHeaders,
      })
      if (await withAuthCheck(response)) return
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = await response.json()
      setPlayers(body.players)
    } catch (err) {
      setError(err.message || t('err.search'))
    }
  }, [authHeaders, withAuthCheck, t])

  const loadEntries = useCallback(async () => {
    setError(null)
    try {
      const response = await fetch('/api/v1/admin/scores', {
        headers: authHeaders,
      })
      if (await withAuthCheck(response)) return
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = await response.json()
      setEntries(body.entries)
      setEntriesLoaded(true)
    } catch (err) {
      setError(err.message || t('err.load'))
    }
  }, [authHeaders, withAuthCheck, t])

  const saveName = async (playerId) => {
    setPendingIds((prev) => new Set(prev).add(playerId))
    setError(null)
    try {
      const response = await fetch(`/api/v1/admin/players/${playerId}`, {
        method: 'PATCH',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: nameDraft }),
      })
      if (await withAuthCheck(response)) return
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.detail || `HTTP ${response.status}`)
      }
      setEditingPlayerId(null)
      await searchPlayers(playerQuery)
    } catch (err) {
      setError(err.message || t('err.save'))
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev)
        next.delete(playerId)
        return next
      })
    }
  }

  const toggleGameDetail = async (gameId) => {
    if (expandedGameId === gameId) {
      setExpandedGameId(null)
      setGameDetail(null)
      return
    }
    setExpandedGameId(gameId)
    setGameDetail(null)
    setError(null)
    try {
      const response = await fetch(`/api/v1/admin/games/${gameId}`, { headers: authHeaders })
      if (await withAuthCheck(response)) return
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const body = await response.json()
      setGameDetail(body)
    } catch (err) {
      setError(err.message || t('err.details'))
    }
  }

  const disqualify = async (gameId) => {
    if (!window.confirm(t('players.confirmDisqualify'))) return
    setPendingIds((prev) => new Set(prev).add(gameId))
    setError(null)
    try {
      const response = await fetch(`/api/v1/admin/games/${gameId}/disqualify`, {
        method: 'POST',
        headers: authHeaders,
      })
      if (await withAuthCheck(response)) return
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.detail || `HTTP ${response.status}`)
      }
      await loadEntries()
    } catch (err) {
      setError(err.message || t('err.delete'))
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev)
        next.delete(gameId)
        return next
      })
    }
  }

  return (
    <div>
      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      <section className="mb-8">
        <h2 className="text-lg font-bold mb-2">{t('players.header')}</h2>
        <form
          onSubmit={(e) => { e.preventDefault(); searchPlayers(playerQuery) }}
          className="mb-4 flex gap-2"
        >
          <input
            type="text"
            value={playerQuery}
            onChange={(e) => setPlayerQuery(e.target.value)}
            placeholder={t('players.searchPlaceholder')}
            className="flex-1 border-2 border-game-border rounded p-2 focus:outline-none focus:ring-2 focus:ring-game-secondary"
          />
          <button
            type="submit"
            className="bg-game-secondary text-white font-semibold rounded px-4 py-2 hover:bg-blue-600 transition-colors"
          >
            {t('common.search')}
          </button>
        </form>

        {players && (
          players.length === 0 ? (
            <p className="text-sm text-game-primary/60">{t('common.noResults')}</p>
          ) : (
            <table className="w-full text-sm border-collapse bg-white rounded-lg overflow-hidden shadow">
              <thead>
                <tr className="text-left border-b-2 border-game-border bg-blue-50">
                  <th className="py-2 px-2">{t('players.name')}</th>
                  <th className="py-2 px-2">{t('players.played')}</th>
                  <th className="py-2 px-2">{t('players.bestScore')}</th>
                  <th className="py-2 px-2">{t('players.registered')}</th>
                  <th className="py-2 px-2">{t('common.action')}</th>
                </tr>
              </thead>
              <tbody>
                {players.map((p) => {
                  const busy = pendingIds.has(p.id)
                  const editing = editingPlayerId === p.id
                  return (
                    <tr key={p.id} className="border-b border-game-border/40">
                      <td className="py-2 px-2 font-semibold">
                        {editing ? (
                          <input
                            type="text"
                            value={nameDraft}
                            onChange={(e) => setNameDraft(e.target.value)}
                            className="border-2 border-game-border rounded p-1 w-full"
                            autoFocus
                          />
                        ) : (
                          p.display_name || <span className="font-normal text-game-primary/40">{t('common.anonymous')}</span>
                        )}
                        {p.is_admin && <span className="ml-1 text-xs text-game-secondary">{t('players.adminTag')}</span>}
                      </td>
                      <td className="py-2 px-2">{p.games_played}</td>
                      <td className="py-2 px-2">{p.best_score ?? '—'}</td>
                      <td className="py-2 px-2">{new Date(p.created_at).toLocaleDateString(adminLocale(lang))}</td>
                      <td className="py-2 px-2 whitespace-nowrap">
                        {editing ? (
                          <>
                            <button
                              onClick={() => saveName(p.id)}
                              disabled={busy}
                              className="text-green-700 underline font-semibold hover:text-green-900 disabled:opacity-40 mr-3"
                            >
                              {t('common.save')}
                            </button>
                            <button
                              onClick={() => setEditingPlayerId(null)}
                              disabled={busy}
                              className="text-game-primary/60 underline hover:text-game-primary disabled:opacity-40"
                            >
                              {t('common.cancel')}
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => { setEditingPlayerId(p.id); setNameDraft(p.display_name || '') }}
                            disabled={busy}
                            className="text-game-secondary underline font-semibold hover:text-blue-700 disabled:opacity-40"
                          >
                            {t('players.rename')}
                          </button>
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

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-bold">{t('players.entriesHeader')}</h2>
          {!entriesLoaded && (
            <button
              onClick={loadEntries}
              className="text-sm text-game-secondary underline hover:text-blue-700"
            >
              {t('players.loadEntries')}
            </button>
          )}
        </div>

        {entries && (
          entries.length === 0 ? (
            <p className="text-sm text-game-primary/60">{t('players.noEntries')}</p>
          ) : (
            <table className="w-full text-sm border-collapse bg-white rounded-lg overflow-hidden shadow">
              <thead>
                <tr className="text-left border-b-2 border-game-border bg-blue-50">
                  <th className="py-2 px-2">{t('players.player')}</th>
                  <th className="py-2 px-2">{t('players.score')}</th>
                  <th className="py-2 px-2">{t('players.length')}</th>
                  <th className="py-2 px-2">{t('common.date')}</th>
                  <th className="py-2 px-2">{t('common.action')}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const busy = pendingIds.has(e.id)
                  const expanded = expandedGameId === e.id
                  return (
                    <Fragment key={e.id}>
                      <tr className="border-b border-game-border/40">
                        <td className="py-2 px-2">
                          {e.display_name || <span className="text-game-primary/40">{t('common.anonymous')}</span>}
                          {e.hinted && <span className="ml-1" title={t('players.hintedTitle')}>💡</span>}
                        </td>
                        <td className="py-2 px-2 font-semibold">{e.final_score}</td>
                        <td className="py-2 px-2">{e.target_length}</td>
                        <td className="py-2 px-2">{new Date(e.ended_at).toLocaleString(adminLocale(lang))}</td>
                        <td className="py-2 px-2 whitespace-nowrap">
                          <button
                            onClick={() => toggleGameDetail(e.id)}
                            className="text-game-secondary underline font-semibold hover:text-blue-700 mr-3"
                          >
                            {expanded ? t('players.close') : t('players.details')}
                          </button>
                          <button
                            onClick={() => disqualify(e.id)}
                            disabled={busy}
                            className="text-red-600 underline font-semibold hover:text-red-800 disabled:opacity-40"
                          >
                            {t('players.disqualify')}
                          </button>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="border-b border-game-border/40 bg-blue-50/50">
                          <td colSpan={5} className="py-3 px-2">
                            {!gameDetail ? (
                              <p className="text-sm text-game-primary/60">{t('common.loading')}</p>
                            ) : (
                              <div className="text-sm">
                                <p className="mb-2">
                                  <span className="font-semibold">{t('players.targetWord')}</span> {gameDetail.game.target_word}
                                  {' · '}
                                  <span className="font-semibold">{t('players.found')}</span>{' '}
                                  {gameDetail.game.found_count}/{gameDetail.game.possible_count}
                                  {' · '}
                                  <span className="font-semibold">{t('players.status')}</span> {gameDetail.game.status}
                                  {gameDetail.game.disqualified_at && t('players.disqualified')}
                                  {' · '}
                                  <span className="font-semibold">{t('players.gameCountry')}</span>{' '}
                                  {gameDetail.game.country || t('players.countryUnknown')}
                                </p>
                                <p className="font-semibold mb-1">{t('players.guessTimeline')}</p>
                                {gameDetail.guesses.length === 0 ? (
                                  <p className="text-game-primary/60 mb-2">{t('players.noGuesses')}</p>
                                ) : (
                                  <ul className="mb-2 space-y-0.5">
                                    {gameDetail.guesses.map((g, i) => (
                                      <li key={i}>
                                        <span className={g.correct ? 'text-green-700' : 'text-red-600'}>
                                          {g.correct ? '✅' : '❌'}
                                        </span>{' '}
                                        {g.word} {g.correct && `(+${g.score} ${t('players.points')})`}{' '}
                                        <span className="text-game-primary/40">
                                          {new Date(g.created_at).toLocaleTimeString(adminLocale(lang))}
                                        </span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                                {gameDetail.hints.length > 0 && (
                                  <>
                                    <p className="font-semibold mb-1">{t('players.hintsHeader')}</p>
                                    <ul className="space-y-0.5">
                                      {gameDetail.hints.map((h, i) => (
                                        <li key={i}>
                                          💡 {h.word} ({t('players.hintLine', { position: h.position, letter: h.letter, cost: h.cost })}){' '}
                                          <span className="text-game-primary/40">
                                            {new Date(h.created_at).toLocaleTimeString(adminLocale(lang))}
                                          </span>
                                        </li>
                                      ))}
                                    </ul>
                                  </>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          )
        )}
      </section>
    </div>
  )
}
