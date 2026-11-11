// ROADMAP 8.1 — optional Google sign-in ("Keep my progress"). Anonymous play never needs
// this. The Neon Auth SDK is imported lazily so players who never tap the button don't
// download it.
import { isJwtShaped } from './admin/jwtShape'

const RETURN_PARAM = 'account'
const OUTCOME_KEY = 'bv_account_outcome'
const PENDING_MERGE_KEY = 'bv_account_pending_merge'

async function client() {
  const { authClient } = await import('./neonAuth.js')
  if (!authClient) throw new Error('auth_not_configured')
  return authClient
}

export function googleSignInAvailable() {
  return Boolean(import.meta.env.VITE_NEON_AUTH_URL)
}

/** Leaves the page: Neon Auth -> Google -> back to /?account=google. */
export async function startGoogleSignIn() {
  const authClient = await client()
  await authClient.signIn.social({
    provider: 'google',
    callbackURL: `${window.location.origin}/?${RETURN_PARAM}=google`,
  })
}

// Same JWT dance as the admin login (AdminApp.jsx, ROADMAP 16.8): session.token is a JWT
// only when the get-session response carried it; otherwise ask /token for one.
async function sessionJwt(authClient) {
  const result = await authClient.getSession()
  const session = result?.data?.session
  if (!session) return null
  if (isJwtShaped(session.token)) return session.token
  const fallback = await authClient.token().catch(() => null)
  return isJwtShaped(fallback?.data?.token) ? fallback.data.token : null
}

/** Runs once on page load. When we've just come back from Google, link this device's
 *  player to the account (the API re-issues the identity cookie), then clean the URL.
 *  Never throws: a failed link must not stop the game from loading. */
export async function completeGoogleSignInIfReturning() {
  const url = new URL(window.location.href)
  if (url.searchParams.get(RETURN_PARAM) !== 'google') return
  let outcome = 'failed'
  try {
    const jwt = await sessionJwt(await client())
    if (jwt) {
      const response = await fetch('/api/v1/account/link', {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}` },
      })
      if (response.ok) outcome = (await response.json()).outcome
      // The phone has real history (10+ games): nothing merged yet, ask the player first.
      else if (response.status === 409) {
        const body = await response.json()
        try { sessionStorage.setItem(PENDING_MERGE_KEY, String(body.device_games ?? '')) } catch { /* storage blocked */ }
        outcome = null
      }
    }
  } catch {
    // keep 'failed'
  }
  if (outcome) {
    try { sessionStorage.setItem(OUTCOME_KEY, outcome) } catch { /* storage blocked */ }
  }
  url.searchParams.delete(RETURN_PARAM)
  url.searchParams.delete('neon_auth_session_verifier')
  window.history.replaceState(null, '', url.pathname + url.search + url.hash)
}

/** The outcome of a sign-in that just completed (shown once in Settings), or null. */
export function takeSignInOutcome() {
  try {
    const value = sessionStorage.getItem(OUTCOME_KEY)
    sessionStorage.removeItem(OUTCOME_KEY)
    return value
  } catch {
    return null
  }
}

/** The signed-in Google account's email, read from the Neon Auth session in the browser.
 *  Our API never reads it; Neon Auth keeps it in its own tables (see the privacy page). Null when the Neon session has lapsed —
 *  the device stays linked either way. */
export async function signedInEmail() {
  try {
    const result = await (await client()).getSession()
    return result?.data?.user?.email ?? null
  } catch {
    return null
  }
}

/** The number of games on this phone when a merge is waiting for the player's yes, or null. */
export function takePendingMerge() {
  try {
    const value = sessionStorage.getItem(PENDING_MERGE_KEY)
    sessionStorage.removeItem(PENDING_MERGE_KEY)
    return value === null ? null : Number(value) || 0
  } catch {
    return null
  }
}

/** The player said yes: repeat the link with confirm_merge, then reload onto the account. */
export async function confirmMerge() {
  let outcome = 'failed'
  try {
    const jwt = await sessionJwt(await client())
    if (jwt) {
      const response = await fetch('/api/v1/account/link', {
        method: 'POST',
        headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm_merge: true }),
      })
      if (response.ok) outcome = (await response.json()).outcome
    }
  } catch {
    // keep 'failed'
  }
  try { sessionStorage.setItem(OUTCOME_KEY, outcome) } catch { /* storage blocked */ }
  window.location.reload()
}

/** The player said no: drop the Google session, the phone keeps its own player untouched. */
export async function cancelMerge() {
  try { await (await client()).signOut() } catch { /* nothing was linked anyway */ }
  try { sessionStorage.setItem(OUTCOME_KEY, 'cancelled') } catch { /* storage blocked */ }
}

/** Device goes back to a fresh anonymous player; the linked one stays on the account. */
export async function signOutGoogle() {
  try { await (await client()).signOut() } catch { /* still drop the device cookie */ }
  await fetch('/api/v1/account/sign-out', { method: 'POST' })
  window.location.reload()
}
