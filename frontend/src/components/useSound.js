import { useCallback, useEffect, useRef, useState } from 'react'
import { betuAPI } from '../api/client'
import { playCue } from './sound'

const STORAGE_KEY = 'betuveto_sound'

function readStored() {
  try {
    // Default OFF (no stored value -> off): browsers block audio before a user gesture,
    // and unprompted sound is a worse surprise than a toggle nobody has found yet.
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * ROADMAP Batch 10 item 8. Owns the sound-on/off state (localStorage-mirrored, synced to
 * `players.sound_enabled` the same way useTheme syncs the colour theme) and returns a
 * stable `play(name)` that no-ops while disabled — stable so wiring it into handleSubmit /
 * handleUseHint doesn't recreate those callbacks. Lifted into <App> (not each consumer)
 * because <SoundToggle> flips the value that App's `play` has to read.
 */
export function useSound() {
  const [soundEnabled, setEnabledState] = useState(readStored)
  const enabledRef = useRef(soundEnabled)
  useEffect(() => { enabledRef.current = soundEnabled }, [soundEnabled])

  // One-time: adopt the server-side preference if the player has one saved.
  useEffect(() => {
    let cancelled = false
    betuAPI.getSoundEnabled()
      .then((serverValue) => {
        if (cancelled || typeof serverValue !== 'boolean') return
        setEnabledState((current) => {
          if (serverValue === current) return current
          try { localStorage.setItem(STORAGE_KEY, serverValue ? '1' : '0') } catch { /* ignore */ }
          return serverValue
        })
      })
      .catch(() => { /* offline / no identity — keep the local choice */ })
    return () => { cancelled = true }
  }, [])

  const setSoundEnabled = useCallback((next) => {
    setEnabledState(next)
    try { localStorage.setItem(STORAGE_KEY, next ? '1' : '0') } catch { /* ignore */ }
    betuAPI.setSoundEnabled(next).catch((err) => {
      console.error('Error saving sound preference:', err)
    })
  }, [])

  const play = useCallback((name) => {
    if (enabledRef.current) playCue(name)
  }, [])

  return { soundEnabled, setSoundEnabled, play }
}
