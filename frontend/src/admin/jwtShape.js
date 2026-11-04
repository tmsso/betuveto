// Same check as lib/jwt-shape.ts (tests/jwt-shape.test.ts keeps the two in step): a compact
// JWS is three non-empty base64url segments. Used to tell Neon Auth's JWT apart from its
// opaque session token, which session.token still holds when the SDK did not receive a
// `set-auth-jwt` header (see AdminApp.jsx).
const SEGMENT = /^[A-Za-z0-9_-]+$/

export function isJwtShaped(value) {
  if (typeof value !== 'string') return false
  const parts = value.split('.')
  return parts.length === 3 && parts.every((p) => SEGMENT.test(p))
}
