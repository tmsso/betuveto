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
 *  Returns that row's id, which is the admin's identity for the audit log (ROADMAP 11.8).
 *  Any failure at any step (no header, bad/expired token, no linked row, linked row not
 *  flagged admin) returns null — same "this branch can't authorize" shape as the token
 *  check above, not a distinguishable error, so neither path leaks which one was tried. */
async function adminSessionPlayerId(req: VercelRequest): Promise<string | null> {
  const header = req.headers.authorization;
  const value = Array.isArray(header) ? header[0] : header;
  if (!value?.startsWith("Bearer ")) return null;

  const verified = await verifyNeonAuthToken(value.slice("Bearer ".length));
  if (!verified) return null;

  const sql = db();
  const [player] = await sql<{ id: string; is_admin: boolean }[]>`
    select id, is_admin from players where auth_user_id = ${verified.userId}
  `;
  return player?.is_admin === true ? player.id : null;
}

/** Who an authorized admin request is. `adminId` is the admin's players.id for a Magic
 *  Link session, or null for the shared ADMIN_TOKEN (everyone holding it looks the same).
 *  Deliberately an object rather than a bare `string | null`: a null id must still mean
 *  "authorized", so it can't double as "denied". Denied is `authorizeAdmin` returning
 *  null itself. */
export interface AdminIdentity {
  adminId: string | null;
}

/** The session is checked first, so a request carrying both credentials is attributed to
 *  the named admin rather than to the anonymous shared token. A token-only request has no
 *  Bearer header, so it costs no extra verification. */
export async function authorizeAdmin(req: VercelRequest): Promise<AdminIdentity | null> {
  const sessionAdminId = await adminSessionPlayerId(req);
  if (sessionAdminId) return { adminId: sessionAdminId };
  if (hasValidAdminToken(req)) return { adminId: null };
  return null;
}

/** One row per admin mutation. `admin` is whatever authorizeAdmin resolved for the
 *  request, passed down explicitly from the route (no request-scoped globals), so a Magic
 *  Link admin is recorded by id and a shared-token admin as null (see the 0004 migration's
 *  comment for why null was the only option before ROADMAP 11.8). Shared by every
 *  admin-mutating module (queue, words, config, players), so every future mutation logs
 *  the same way without re-implementing this. */
export async function logAdminAction(
  admin: AdminIdentity,
  action: string,
  payload: Record<string, string | number | boolean>,
): Promise<void> {
  const sql = db();
  await sql`
    insert into admin_audit_log (admin_id, action, payload)
    values (${admin.adminId}, ${action}, ${sql.json(payload)})
  `;
}

/** Several audit rows in one insert (ROADMAP 13.5's bulk word actions write one row per
 *  word, like the single-word routes do, so the log reads the same either way). */
export async function logAdminActions(
  admin: AdminIdentity,
  entries: { action: string; payload: Record<string, string | number | boolean> }[],
): Promise<void> {
  if (entries.length === 0) return;
  const sql = db();
  const rows = entries.map((e) => ({ admin_id: admin.adminId, action: e.action, payload: sql.json(e.payload) }));
  await sql`insert into admin_audit_log ${sql(rows, "admin_id", "action", "payload")}`;
}
