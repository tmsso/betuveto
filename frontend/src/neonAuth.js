// Neon Auth client for the Magic Link admin login (ROADMAP 5.2 follow-up design).
// `VITE_NEON_AUTH_URL` is unset until the Neon console values are wired up as Vercel env
// vars — `authClient` is null in that case rather than throwing, so the rest of the admin
// app can render the existing ADMIN_TOKEN path even when this feature isn't configured.
import { createAuthClient } from '@neondatabase/auth'

const url = import.meta.env.VITE_NEON_AUTH_URL

export const authClient = url ? createAuthClient(url) : null
