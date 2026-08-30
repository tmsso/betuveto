import { useCallback, useMemo, useState } from 'react'
import { AdminLangContext, STORAGE_KEY, SUPPORTED, readStored, translate } from './adminI18n'

/**
 * ROADMAP Batch 10 item 14 — provides the admin-shell language and `t()`. Split from
 * adminI18n.js (which holds the catalog + hook + helpers) only so each file has one kind
 * of export and Vite fast-refresh stays happy.
 */
export function AdminLangProvider({ children }) {
  const [lang, setLangState] = useState(readStored)

  const setLang = useCallback((next) => {
    if (!SUPPORTED.includes(next)) return
    setLangState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch { /* private mode — keep the in-memory choice */ }
  }, [])

  const value = useMemo(
    () => ({ lang, setLang, t: (key, vars) => translate(lang, key, vars) }),
    [lang, setLang],
  )

  return <AdminLangContext.Provider value={value}>{children}</AdminLangContext.Provider>
}
