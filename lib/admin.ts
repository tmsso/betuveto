/**
 * Interim admin auth (ROADMAP Batch 5.1): a single shared secret sent as a request
 * header, not a real per-admin login — there's no session concept for admins until
 * Batch 8's Google OAuth makes `players.is_admin` load-bearing (that column has existed
 * since Batch 1.1's schema but stays unused until then). Deliberately simpler for now,
 * per the ROADMAP's own note that a token header is "acceptable and simple" as an
 * interim measure.
 */
import { timingSafeEqual } from "node:crypto";
import type { VercelRequest } from "@vercel/node";

const ADMIN_TOKEN_HEADER = "x-admin-token";

/**
 * Unlike lib/scores.ts's `scoresTopRoute`, which degrades gracefully when
 * ANON_SESSION_SECRET is missing (a leaderboard needs no identity at all), a missing
 * ADMIN_TOKEN here must deny every request rather than let one through — degrading open
 * would mean anyone with *no* token gets admin access.
 */
export function isAdminAuthorized(req: VercelRequest): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return false;

  const provided = req.headers[ADMIN_TOKEN_HEADER];
  if (typeof provided !== "string" || provided.length === 0) return false;

  // Arbitrary-length UTF-8, not hex (unlike lib/auth.ts's HMAC tag) — plain Buffer.from,
  // and the length check first since timingSafeEqual throws on mismatched lengths rather
  // than just comparing false.
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
