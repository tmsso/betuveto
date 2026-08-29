/**
 * Server-side verification for Neon Auth (Managed Better Auth) session tokens — the
 * Magic Link admin login (ROADMAP 5.2 item 2 follow-up design). Deliberately the raw
 * JWKS-verification path (`jose`), not `@neondatabase/auth/next/server`'s `createNeonAuth`
 * — that helper is Next.js-only (its own signed-cookie session, middleware, RSC support),
 * none of which applies to this project's Vite frontend + hand-rolled Vercel dispatcher.
 * The client instead calls `getJWTToken()` and sends it as a Bearer header — Neon Auth's
 * base URL is a different registrable domain from this app's, so a session cookie the
 * callback sets would never be attached to a same-site check against our own API anyway.
 */
import { createRemoteJWKSet, jwtVerify } from "jose";
import { log, serializeError } from "./log.js";

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks(): ReturnType<typeof createRemoteJWKSet> | null {
  const jwksUrl = process.env.NEON_AUTH_JWKS_URL;
  if (!jwksUrl) return null;
  if (!jwks) jwks = createRemoteJWKSet(new URL(jwksUrl));
  return jwks;
}

/**
 * Verifies a bearer token against Neon's published JWKS for this project and returns the
 * token's `sub` claim (the Neon Auth user id) on success, or null on any failure —
 * expired, malformed, wrong signature, or the feature not configured at all
 * (`NEON_AUTH_JWKS_URL` unset, e.g. before the Neon console values are wired up).
 * Issuer is checked when `NEON_AUTH_BASE_URL` is set; skipped (not failed) when it isn't,
 * since the JWKS signature check alone already ties the token to this Neon project's keys.
 * Checked against the bare origin, not the full `NEON_AUTH_BASE_URL` — that env var also
 * prefixes the JWKS/session API paths (`/neondb/auth/...`), but Neon signs `iss` as just
 * the host, confirmed against a real token's claims in production on 2026-08-21 (a prior
 * version compared against the full path and rejected every real token with
 * `unexpected "iss" claim value`).
 */
export async function verifyNeonAuthToken(token: string): Promise<{ userId: string } | null> {
  const set = getJwks();
  if (!set) return null;

  try {
    const base = process.env.NEON_AUTH_BASE_URL;
    const issuer = base ? new URL(base).origin : undefined;
    const { payload } = await jwtVerify(token, set, issuer ? { issuer } : {});
    return typeof payload.sub === "string" ? { userId: payload.sub } : null;
  } catch (error) {
    // Deliberately still returns null either way (see the doc comment above) — but until
    // now every failure mode (404 on the JWKS URL, an issuer mismatch, real expiry, a bad
    // signature) collapsed into the same silent 401 with nothing in Vercel's logs to tell
    // them apart. This is what the 2026-08-21 investigation needed and didn't have.
    log.error("neon_auth_verify_failed", serializeError(error));
    return null;
  }
}
