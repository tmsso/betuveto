/**
 * True when a string has the compact JWS layout `header.payload.signature`: three
 * non-empty base64url segments. A cheap pre-check, not a verification. It separates "the
 * client sent something that is not a JWT at all" (e.g. Neon Auth's opaque session token,
 * which `session.token` still holds when a get-session response lacked the `set-auth-jwt`
 * header) from "a real JWT that failed verification", so the two log differently.
 * Mirrored in frontend/src/admin/jwtShape.js; tests/jwt-shape.test.ts checks both agree.
 */
const SEGMENT = /^[A-Za-z0-9_-]+$/;

export function isJwtShaped(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const parts = value.split(".");
  return parts.length === 3 && parts.every((p) => SEGMENT.test(p));
}
