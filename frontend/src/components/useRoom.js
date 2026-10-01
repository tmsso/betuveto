import { useCallback, useEffect, useRef, useState } from 'react'
import { betuAPI } from '../api/client'

// ROADMAP 7.2.5 — the client side of a multiplayer room: which room this tab is in, the
// latest snapshot, and the polling that keeps it fresh (owner decision D1: polling first,
// no realtime vendor). docs/multiplayer.md §5: 3 s, paused while the tab is hidden, and
// stopped once there's nothing left to wait for.
const POLL_MS = 3000
// sessionStorage, not localStorage: a reload returns to the room, but a new tab or
// tomorrow's visit starts clean rather than reopening a long-finished room.
const STORAGE_KEY = 'betuveto_room'

function readStoredCode() {
  try {
    return sessionStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function storeCode(code) {
  try {
    if (code) sessionStorage.setItem(STORAGE_KEY, code)
    else sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* storage blocked (private mode) — the room just won't survive a reload */
  }
}

/** Server `detail` codes → i18n keys under `room.errors`. Anything unknown → generic. */
const KNOWN_ERRORS = ['room_full', 'room_started', 'room_cancelled', 'not_enough_players', 'not_host', 'rate_limited']
export function roomErrorKey(err) {
  if (err?.status === 404) return 'room.errors.not_found'
  if (err?.status === 429) return 'room.errors.rate_limited'
  if (err?.code && KNOWN_ERRORS.includes(err.code)) return `room.errors.${err.code}`
  if (err?.status === 422) return 'room.errors.invalid_name'
  return 'room.errors.generic'
}

/** Whether a snapshot is still worth polling: lobby and playing always; a finished room
 *  only until its rematch pointer shows up (that's what the other members wait for). */
function shouldPoll(room) {
  if (!room) return true
  if (room.status === 'lobby' || room.status === 'playing') return true
  return room.status === 'finished' && !room.next_room_code
}

export function useRoom() {
  const [code, setCode] = useState(readStoredCode)
  const [room, setRoom] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null) // an i18n key, translated at render
  // The latest code for async callbacks (a poll answering after the player has already
  // left must not resurrect the old room). Synced in an effect, not during render — the
  // React hooks lint forbids writing refs while rendering.
  const codeRef = useRef(code)
  useEffect(() => {
    codeRef.current = code
  }, [code])

  const enter = useCallback((nextCode, snapshot) => {
    codeRef.current = nextCode
    storeCode(nextCode)
    setCode(nextCode)
    setRoom(snapshot ?? null)
    setError(null)
  }, [])

  const clear = useCallback(() => {
    codeRef.current = null
    storeCode(null)
    setCode(null)
    setRoom(null)
  }, [])

  const refresh = useCallback(async () => {
    const current = codeRef.current
    if (!current) return null
    try {
      const snapshot = await betuAPI.getRoom(current)
      // Ignore a late answer for a room this tab has already left or swapped out of.
      if (codeRef.current === current) setRoom(snapshot)
      return snapshot
    } catch (err) {
      // 404 = unknown room or not a member any more; 401 = no identity (cookies cleared).
      if (err?.status === 404 || err?.status === 401) {
        if (codeRef.current === current) clear()
      }
      return null
    }
  }, [clear])

  // Polling. Restarted whenever the room changes status (so it can stop on its own),
  // paused while the tab is hidden, with an immediate refresh when it becomes visible.
  const pollable = shouldPoll(room)
  useEffect(() => {
    if (!code || !pollable) return
    let timer = null
    const schedule = () => {
      clearInterval(timer)
      timer = document.hidden ? null : setInterval(refresh, POLL_MS)
    }
    const onVisibility = () => {
      if (!document.hidden) refresh()
      schedule()
    }
    refresh()
    schedule()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [code, pollable, refresh])

  const run = useCallback(async (fn) => {
    setBusy(true)
    setError(null)
    try {
      return await fn()
    } catch (err) {
      console.error('Room request failed:', err)
      setError(roomErrorKey(err))
      return null
    } finally {
      setBusy(false)
    }
  }, [])

  const create = useCallback((opts) => run(async () => {
    const { code: newCode, room: snapshot } = await betuAPI.createRoom(opts)
    enter(newCode, snapshot)
    return snapshot
  }), [run, enter])

  const join = useCallback((joinCode, displayName) => run(async () => {
    const normalized = joinCode.trim().toUpperCase()
    const { room: snapshot } = await betuAPI.joinRoom(normalized, displayName)
    enter(normalized, snapshot)
    return snapshot
  }), [run, enter])

  const start = useCallback(() => run(async () => {
    const snapshot = await betuAPI.startRoom(codeRef.current)
    setRoom(snapshot)
    return snapshot
  }), [run])

  // Lobby: tells the server (a leaving host cancels the room, D4). Any other state: just
  // stop following the room locally — during play, "leaving" is giving up (give_up route).
  const leave = useCallback(async () => {
    const current = codeRef.current
    if (current && room?.status === 'lobby') {
      await betuAPI.leaveRoom(current).catch((err) => console.error('Error leaving room:', err))
    }
    clear()
  }, [room?.status, clear])

  // Host: create the rematch lobby and move there (already a member of it).
  const rematch = useCallback(() => run(async () => {
    const { code: nextCode } = await betuAPI.rematchRoom(codeRef.current)
    const snapshot = await betuAPI.getRoom(nextCode)
    enter(nextCode, snapshot)
    return snapshot
  }), [run, enter])

  return { code, room, busy, error, setError, refresh, create, join, start, leave, rematch }
}
