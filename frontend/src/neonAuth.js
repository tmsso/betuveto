// Neon Auth client for the Magic Link admin login (ROADMAP 5.2 follow-up design).
// `VITE_NEON_AUTH_URL` is unset until the Neon console values are wired up as Vercel env
// vars — `authClient` is null in that case rather than throwing, so the admin app can render
// a "sign-in not configured" message instead of crashing (the shared-token login that used to
// be the fallback here was removed 2026-11-19, ROADMAP 16.8 (a)).
import { createAuthClient } from '@neondatabase/auth'

const url = import.meta.env.VITE_NEON_AUTH_URL

export const authClient = url ? createAuthClient(url) : null
