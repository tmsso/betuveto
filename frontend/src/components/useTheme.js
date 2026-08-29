import { useCallback, useEffect, useState } from 'react'
import { betuAPI } from '../api/client'

const STORAGE_KEY = 'betuveto_theme'
const THEMES = ['light', 'dark', 'system']

function systemPrefersDark() {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches === true
}

function readStored() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return THEMES.includes(v) ? v : 'system'
  } catch {
    return 'system'
  }
}

/** Toggle `.dark` on <html> to match the effective theme. The same rule the pre-paint
 *  script in index.html applies, kept in sync here for changes after load. */
function applyTheme(theme) {
  const dark = theme === 'dark' || (theme === 'system' && systemPrefersDark())
  document.documentElement.classList.toggle('dark', dark)
}

/**
 * ROADMAP Batch 10 item 7 — three-way colour theme: 'light' | 'dark' | 'system'.
 * Resolution order mirrors preferred_language: the player's stored choice, else the OS
 * `prefers-color-scheme`, else light. localStorage is the pre-paint fast path (index.html);
 * the server-side `preferred_theme` is loaded once on mount and, when set, wins over a
 * bare local value so the choice follows the player across devices.
 */
export function useTheme() {
  const [theme, setThemeState] = useState(readStored)

  // Re-apply on every change, and — in 'system' mode — whenever the OS setting flips.
  useEffect(() => {
    applyTheme(theme)
    if (theme !== 'system' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  // One-time: adopt the server-side preference if the player has one saved (a no-op for a
  // first visitor — no cookie yet means preferred_theme comes back null).
  useEffect(() => {
    let cancelled = false
    betuAPI.getPreferredTheme()
      .then((serverTheme) => {
        if (cancelled || !THEMES.includes(serverTheme)) return
        setThemeState((current) => {
          if (serverTheme === current) return current
          try { localStorage.setItem(STORAGE_KEY, serverTheme) } catch { /* ignore */ }
          return serverTheme
        })
      })
      .catch(() => { /* offline / no identity — keep the local choice */ })
    return () => { cancelled = true }
  }, [])

  const setTheme = useCallback((next) => {
    if (!THEMES.includes(next)) return
    setThemeState(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch { /* ignore */ }
    betuAPI.setPreferredTheme(next).catch((err) => {
      console.error('Error saving theme preference:', err)
    })
  }, [])

  return { theme, setTheme }
}
