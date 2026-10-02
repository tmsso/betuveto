import { useCallback, useEffect, useState } from 'react'
import { useAdminT } from './admin/adminI18n'

// ROADMAP 12.7 — tester feedback from the in-app form. Newest first; "open" hides what's
// already been marked done. Messages are rendered as plain text (React escapes them), never
// as HTML: they are arbitrary player input.

export default function AdminFeedbackPanel({ authHeaders, onAuthError }) {
  const { t } = useAdminT()
  const [status, setStatus] = useState('open')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [pendingId, setPendingId] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/v1/admin/feedback?status=${status}`, { headers: authHeaders })
      if (response.status === 401) {
        onAuthError()
        return
      }
      if (response.status === 503) {
        setError(t('feedback.unavailable'))
        return
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      setData(await response.json())
    } catch (err) {
      setError(err.message || t('err.load'))
    } finally {
      setLoading(false)
    }
  }, [authHeaders, onAuthError, status, t])

  useEffect(() => {
    load()
  }, [load])

  const resolve = async (id) => {
    setPendingId(id)
    try {
      const response = await fetch(`/api/v1/admin/feedback/${id}/resolve`, {
        method: 'POST',
        headers: authHeaders,
      })
      if (response.status === 401) {
        onAuthError()
        return
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      await load()
    } catch (err) {
      setError(err.message || t('err.load'))
    } finally {
      setPendingId(null)
    }
  }

  const rows = data?.feedback ?? []

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-bold">
          {t('feedback.title')}
          {data && <span className="ml-2 text-sm font-normal text-gray-500">{t('feedback.openCount', { count: data.open_count })}</span>}
        </h2>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          aria-label={t('feedback.filter')}
          className="ml-auto border rounded px-2 py-1 text-sm"
        >
          <option value="open">{t('feedback.filterOpen')}</option>
          <option value="all">{t('feedback.filterAll')}</option>
        </select>
      </div>

      {loading && !data && <p className="text-sm text-gray-500">{t('common.loading')}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {data && rows.length === 0 && <p className="text-sm text-gray-500">{t('feedback.empty')}</p>}

      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <li key={row.id} className="bg-white rounded-lg shadow p-3 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-3 text-xs text-gray-500">
              <span>{new Date(row.created_at).toLocaleString()}</span>
              <span>{row.display_name ?? t('feedback.anonymous')}{row.is_ci ? ' (CI)' : ''}</span>
              {row.ui_language && <span>{row.ui_language}</span>}
              {row.resolved_at && <span className="text-green-700">✓ {t('feedback.resolved')}</span>}
            </div>
            <p className="mt-1 whitespace-pre-wrap break-words">{row.message}</p>
            {(row.page_url || row.user_agent) && (
              <p className="mt-1 text-xs text-gray-400 break-all">
                {row.page_url}{row.page_url && row.user_agent ? ' · ' : ''}{row.user_agent}
              </p>
            )}
            {!row.resolved_at && (
              <button
                type="button"
                onClick={() => resolve(row.id)}
                disabled={pendingId === row.id}
                className="mt-2 rounded border px-2 py-1 text-xs hover:bg-gray-100 disabled:opacity-50"
              >
                {t('feedback.markResolved')}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
