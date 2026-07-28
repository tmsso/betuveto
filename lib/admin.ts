/**
 * Admin auth (ROADMAP Batch 5.1, Magic Link follow-up): either a shared secret sent as a
 * request header (5.1's interim token, still supported so nobody's locked out mid-
 * transition), or a Neon Auth session bearer token whose linked `players` row has
 * `is_admin` (the Magic Link design). `players.is_admin` has existed since Batch 1.1's
 * schema but only became reachable this way — Batch 8's Google OAuth will be the third
 * path into the same check, not a replacement for either of these.
 */
import { timingSafeEqual } from "node:crypto";
import type { VercelRequest } from "@vercel/node";
import { db } from "./db.js";
import { verifyNeonAuthToken } from "./neon-auth.js";

const ADMIN_TOKEN_HEADER = "x-admin-token";

/**
 * Unlike lib/scores.ts's `scoresTopRoute`, which degrades gracefully when
 * ANON_SESSION_SECRET is missing (a leaderboard needs no identity at all), a missing
 * ADMIN_TOKEN must not let a bare/empty header through — it only rules out *this*
 * branch, not the request overall, since a Neon Auth session can independently
 * authorize below. Only when neither branch can succeed is the request denied.
 */
function hasValidAdminToken(req: VercelRequest): boolean {
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

/** Bearer token → verified Neon Auth user id → linked `players` row with `is_admin`.
 *  Any failure at any step (no header, bad/expired token, no linked row, linked row not
 *  flagged admin) returns false — same "this branch can't authorize" shape as the token
 *  check above, not a distinguishable error, so neither path leaks which one was tried. */
async function hasValidAdminSession(req: VercelRequest): Promise<boolean> {
  const header = req.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (!value?.startsWith("Bearer ")) return false;

  const verified = await verifyNeonAuthToken(value.slice("Bearer ".length));
  if (!verified) return false;

  const sql = db();
  const [player] = await sql<{ is_admin: boolean }[]>`
    select is_admin from players where auth_user_id = ${verified.userId}
  `;
  return player?.is_admin === true;
}

export async function isAdminAuthorized(req: VercelRequest): Promise<boolean> {
  return hasValidAdminToken(req) || (await hasValidAdminSession(req));
}

/** One row per admin mutation, admin_id left null — see the 0004 migration's comment for
 *  why: the interim token auth (5.1) has no per-admin identity to attribute this to yet.
 *  Shared by every admin-mutating module (queue, words, config, players) so every future
 *  mutation logs the same way without re-implementing this. */
export async function logAdminAction(
  action: string,
  payload: Record<string, string | number>,
): Promise<void> {
  const sql = db();
  await sql`
    insert into admin_audit_log (action, payload) values (${action}, ${sql.json(payload)})
  `;
}
