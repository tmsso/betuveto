import { useCallback, useEffect, useState } from 'react'
import { betuAPI } from '../api/client'

/**
 * ROADMAP 7.2.0 — the player's own display name, shown on the leaderboards in place of
 * "Névtelen játékos" once set. No localStorage fast path (unlike useTheme): nothing paints
 * before first render depends on this value, so a server round-trip on mount is fine.
 */
export function useDisplayName() {
  const [displayName, setDisplayNameState] = useState(null)

  useEffect(() => {
    let cancelled = false
    betuAPI.getDisplayName()
      .then((name) => { if (!cancelled) setDisplayNameState(name) })
      .catch(() => { /* offline / no identity yet — leave as null */ })
    return () => { cancelled = true }
  }, [])

  const setDisplayName = useCallback(async (next) => {
    await betuAPI.setDisplayName(next)
    setDisplayNameState(next)
  }, [])

  return { displayName, setDisplayName }
}
