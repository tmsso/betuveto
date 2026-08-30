import { useCallback, useEffect, useMemo, useState } from 'react'
import AdminConfigPanel from './AdminConfigPanel'
import AdminDashboardPanel from './AdminDashboardPanel'
import AdminPlayersPanel from './AdminPlayersPanel'
import AdminWordsPanel from './AdminWordsPanel'
import { AdminLangProvider } from './admin/AdminLangProvider'
import { ADMIN_LANGUAGES, adminLocale, useAdminT } from './admin/adminI18n'
import { authClient } from './neonAuth'

// Interim admin auth (ROADMAP 5.1): a shared token, not a real per-admin login — see
// lib/admin.ts for why. Stored client-side only in this browser's localStorage; never
// sent anywhere except as this app's own x-admin-token header. Kept in parallel with the
// Neon Auth session below (ROADMAP 5.2 follow-up) per the transition plan there — a
// same-day cutover risks locking out the only admin if the new path has an edge case
// nobody's hit yet, so both stay live until the session path is confirmed working.
const TOKEN_KEY = 'bv_admin_token'

// Wrapper so useAdminT works everywhere inside, including AdminAppInner's own body.
export default function AdminApp() {
  return (
    <AdminLangProvider>
      <AdminAppInner />
    </AdminLangProvider>
  )
}

function AdminAppInner() {
  const { lang, setLang, t } = useAdminT()
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '')
  const [tokenInput, setTokenInput] = useState('')
  // The Neon Auth session's own bearer JWT (ROADMAP 5.2 follow-up) — null until a magic
  // link has actually been followed. Checked once on mount.
  const [sessionJwt, setSessionJwt] = useState(null)
  const [sessionChecked, setSessionChecked] = useState(!authClient)
  const [magicLinkEmail, setMagicLinkEmail] = useState('')
  const [magicLinkSent, setMagicLinkSent] = useState(false)
  const [magicLinkError, setMagicLinkError] = useState(null)
  const [tab, setTab] = useState('dashboard')
  const [queue, setQueue] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  // Keys of rows with a mutation in flight (e.g. "report-12", "suggestion-7"), so only
  // that row's buttons disable rather than the whole page freezing during one request.
  const [pendingRows, setPendingRows] = useState(() => new Set())

  useEffect(() => {
    if (!authClient) return
    // getSession() directly, NOT the SDK's own getJWTToken() convenience method — found
    // live against production 2026-08-20: getJWTToken() calls a bare /get-jwt-token that
    // bypasses the request hooks handling Neon's cross-origin session handoff (the
    // ?neon_auth_session_verifier=... param a magic-link redirect lands with, since the
    // session cookie itself is set on Neon's own domain, not this app's). getSession()
    // does go through those hooks — confirmed directly against the SDK's own source and
    // by probing it with a real fetch interceptor — so it actually picks up a session
    // right after following the link, where getJWTToken() silently never could. The JWT
    // itself rides on the response as session.token (the SDK copies it there from a
    // set-auth-jwt response header on success).
    authClient
      .getSession()
      .then((result) => setSessionJwt(result?.data?.session?.token ?? null))
      // No session yet (the common case until an admin actually completes a magic link)
      // surfaces as a rejected AuthApiError here, not a clean resolved null — caught
      // directly against production before shipping. Same outcome as "no session" either
      // way, so this stays a no-op rather than surfacing as an unhandled rejection.
      .catch(() => setSessionJwt(null))
      .finally(() => setSessionChecked(true))
  }, [])

  // Whichever credential is live — the legacy token takes precedence only because it's
  // the one already in localStorage from a prior session; a fresh magic-link sign-in sets
  // sessionJwt, not token, so there's no real conflict in practice.
  const authHeaders = useMemo(() => {
    if (token) return { 'x-admin-token': token }
    if (sessionJwt) return { Authorization: `Bearer ${sessionJwt}` }
    return null
  }, [token, sessionJwt])
  const isAuthenticated = authHeaders !== null

  const loadQueue = useCallback(async (headers) => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/v1/admin/queue', { headers })
      if (response.status === 401) {
        localStorage.removeItem(TOKEN_KEY)
        setToken('')
        setSessionJwt(null)
        setError(t('err.invalidToken'))
        return
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setQueue(await response.json())
    } catch (err) {
      setError(err.message || t('err.fetch'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (authHeaders && tab === 'queue' && !queue) loadQueue(authHeaders)
  }, [authHeaders, tab, queue, loadQueue])

  const runMutation = useCallback(async (rowKey, path, decision) => {
    setPendingRows((prev) => new Set(prev).add(rowKey))
    setError(null)
    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      })
      if (response.status === 401) {
        localStorage.removeItem(TOKEN_KEY)
        setToken('')
        setSessionJwt(null)
        setError(t('err.invalidToken'))
        return
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      await loadQueue(authHeaders)
    } catch (err) {
      setError(err.message || t('err.mutation'))
    } finally {
      setPendingRows((prev) => {
        const next = new Set(prev)
        next.delete(rowKey)
        return next
      })
    }
  }, [authHeaders, loadQueue, t])

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

  const handleMagicLinkSubmit = async (e) => {
    e.preventDefault()
    const trimmed = magicLinkEmail.trim()
    if (!trimmed || !authClient) return
    setMagicLinkError(null)
    try {
      await authClient.signIn.magicLink({
        email: trimmed,
        callbackURL: `${window.location.origin}/admin`,
      })
      setMagicLinkSent(true)
    } catch (err) {
      setMagicLinkError(err.message || t('login.magicError'))
    }
  }

  const handleLogout = () => {
    localStorage.removeItem(TOKEN_KEY)
    setToken('')
    setSessionJwt(null)
    setQueue(null)
    setMagicLinkSent(false)
    authClient?.signOut()
  }

  // Avoids a flash of the login form for a returning admin whose Neon Auth session is
  // still valid — getJWTToken() is async even when it resolves from the SDK's own cache.
  if (!sessionChecked) return null

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-game-paper p-6">
        <div className="bg-white border-4 border-game-border rounded-lg p-6 w-full max-w-sm shadow-lg">
          <h1 className="text-xl font-extrabold text-game-primary mb-4">{t('app.title')}</h1>

          {authClient && (
            <>
              {magicLinkSent ? (
                <p className="text-sm text-game-primary/80 mb-4">
                  {t('login.magicSent', { email: magicLinkEmail })}
                </p>
              ) : (
                <form onSubmit={handleMagicLinkSubmit} className="mb-4">
                  <input
                    type="email"
                    aria-label={t('login.emailLabel')}
                    value={magicLinkEmail}
                    onChange={(e) => setMagicLinkEmail(e.target.value)}
                    placeholder={t('login.emailPlaceholder')}
                    className="w-full border-2 border-game-border rounded p-2 mb-2 focus:outline-none focus:ring-2 focus:ring-game-secondary"
                    autoFocus
                  />
                  {magicLinkError && (
                    <p className="text-sm text-red-600 mb-2">{magicLinkError}</p>
                  )}
                  <button
                    type="submit"
                    className="w-full bg-game-secondary text-white font-semibold rounded p-2 hover:bg-blue-600 transition-colors"
                  >
                    {t('login.magicSend')}
                  </button>
                </form>
              )}
              <div className="flex items-center gap-2 text-xs text-game-primary/40 mb-4">
                <div className="flex-1 border-t border-game-border" />
                {t('login.or')}
                <div className="flex-1 border-t border-game-border" />
              </div>
            </>
          )}

          <form onSubmit={handleTokenSubmit}>
            <input
              type="password"
              aria-label={t('login.tokenLabel')}
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder={t('login.tokenLabel')}
              className="w-full border-2 border-game-border rounded p-2 mb-4 focus:outline-none focus:ring-2 focus:ring-game-secondary"
            />
            <button
              type="submit"
              className="w-full bg-game-primary/80 text-white font-semibold rounded p-2 hover:bg-game-primary transition-colors"
            >
              {t('login.tokenSubmit')}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-game-paper p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-extrabold text-game-primary">{t('app.title')}</h1>
          <div className="flex items-center gap-3">
            {/* ROADMAP Batch 10 item 14 — admin-shell language, independent of any player's
                preferred_language. */}
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              aria-label={t('app.langLabel')}
              className="text-sm border border-game-border rounded px-2 py-1 bg-white text-game-primary"
            >
              {ADMIN_LANGUAGES.map(({ code, label }) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </select>
            <button
              onClick={handleLogout}
              className="text-sm underline text-game-primary/70 hover:text-game-primary"
            >
              {t('app.logout')}
            </button>
          </div>
        </div>

        <div className="flex gap-4 mb-6 border-b-2 border-game-border">
          {[
            ['dashboard', t('tabs.dashboard')],
            ['queue', t('tabs.queue')],
            ['words', t('tabs.words')],
            ['config', t('tabs.config')],
            ['players', t('tabs.players')],
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

        {tab === 'dashboard' && <AdminDashboardPanel authHeaders={authHeaders} onAuthError={handleLogout} />}
        {tab === 'words' && <AdminWordsPanel authHeaders={authHeaders} onAuthError={handleLogout} />}
        {tab === 'config' && <AdminConfigPanel authHeaders={authHeaders} onAuthError={handleLogout} />}
        {tab === 'players' && <AdminPlayersPanel authHeaders={authHeaders} onAuthError={handleLogout} />}

        {tab === 'queue' && (
        <>
        {loading && <p className="text-sm text-game-primary/70">{t('common.loading')}</p>}
        {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

        {queue && (
          <>
            <section className="mb-8">
              <h2 className="text-lg font-bold mb-2">{t('queue.reportsHeader', { count: queue.reports.length })}</h2>
              {queue.reports.length === 0 ? (
                <p className="text-sm text-game-primary/60">{t('queue.noReports')}</p>
              ) : (
                <table className="w-full text-sm border-collapse bg-white rounded-lg overflow-hidden shadow">
                  <thead>
                    <tr className="text-left border-b-2 border-game-border bg-blue-50">
                      <th className="py-2 px-2">{t('common.word')}</th>
                      <th className="py-2 px-2">{t('common.wordlist')}</th>
                      <th className="py-2 px-2">{t('common.activeQ')}</th>
                      <th className="py-2 px-2">{t('queue.firstReport')}</th>
                      <th className="py-2 px-2">{t('common.decision')}</th>
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
                                {t('queue.reportedNx', { count: r.report_count })}
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-2">{r.wordlist}</td>
                          <td className="py-2 px-2">{r.active ? t('common.yes') : t('queue.inactive')}</td>
                          <td className="py-2 px-2">{new Date(r.first_reported_at).toLocaleString(adminLocale(lang))}</td>
                          <td className="py-2 px-2 whitespace-nowrap">
                            <button
                              onClick={() => handleResolveReport(r.word_id, 'accept')}
                              disabled={busy}
                              title={t('queue.acceptTitle')}
                              className="text-red-600 underline font-semibold hover:text-red-800 disabled:opacity-40 mr-3"
                            >
                              {t('queue.accept')}
                            </button>
                            <button
                              onClick={() => handleResolveReport(r.word_id, 'reject')}
                              disabled={busy}
                              title={t('queue.rejectTitle')}
                              className="text-green-700 underline font-semibold hover:text-green-900 disabled:opacity-40"
                            >
                              {t('queue.reject')}
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
              <h2 className="text-lg font-bold mb-2">{t('queue.suggestionsHeader', { count: queue.suggestions.length })}</h2>
              {queue.suggestions.length === 0 ? (
                <p className="text-sm text-game-primary/60">{t('queue.noSuggestions')}</p>
              ) : (
                <table className="w-full text-sm border-collapse bg-white rounded-lg overflow-hidden shadow">
                  <thead>
                    <tr className="text-left border-b-2 border-game-border bg-blue-50">
                      <th className="py-2 px-2">{t('common.word')}</th>
                      <th className="py-2 px-2">{t('common.wordlist')}</th>
                      <th className="py-2 px-2">{t('queue.suggestedBy')}</th>
                      <th className="py-2 px-2">{t('common.date')}</th>
                      <th className="py-2 px-2">{t('common.action')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queue.suggestions.map((s) => {
                      const busy = pendingRows.has(`suggestion-${s.id}`)
                      return (
                        <tr key={s.id} className="border-b border-game-border/40">
                          <td className="py-2 px-2 font-semibold">{s.word}</td>
                          <td className="py-2 px-2">{s.wordlist}</td>
                          <td className="py-2 px-2">{s.suggested_by || t('common.anonymous')}</td>
                          <td className="py-2 px-2">{new Date(s.created_at).toLocaleString(adminLocale(lang))}</td>
                          <td className="py-2 px-2 whitespace-nowrap">
                            <button
                              onClick={() => handleResolveSuggestion(s.id, 'approve')}
                              disabled={busy}
                              className="text-green-700 underline hover:text-green-900 disabled:opacity-40 mr-3"
                            >
                              {t('queue.approve')}
                            </button>
                            <button
                              onClick={() => handleResolveSuggestion(s.id, 'reject')}
                              disabled={busy}
                              className="text-red-600 underline hover:text-red-800 disabled:opacity-40"
                            >
                              {t('queue.decline')}
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
