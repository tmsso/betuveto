/**
 * Admin auth (ROADMAP Batch 5.1, Magic Link follow-up): a Neon Auth session bearer token whose
 * linked `players` row has `is_admin`. Google sign-in (Batch 8) reaches the same check.
 *
 * The shared `ADMIN_TOKEN` header that 5.1 started with was retired on 2026-11-19 (ROADMAP
 * 16.8 (a)): it was removed from the Production env first, then this code path. Every admin
 * request is therefore attributable to a named admin (`adminId` below is never null).
 */
import type { VercelRequest } from "@vercel/node";
import { db } from "./db.js";
import { verifyNeonAuthToken } from "./neon-auth.js";

/** Bearer token → verified Neon Auth user id → linked `players` row with `is_admin`.
 *  Returns that row's id, which is the admin's identity for the audit log (ROADMAP 11.8).
 *  Any failure at any step (no header, bad/expired token, no linked row, linked row not
 *  flagged admin) returns null, not a distinguishable error, so a caller learns nothing
 *  about which step failed. */
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

/** Who an authorized admin request is: the admin's players.id, recorded in the audit log.
 *  An object rather than a bare string so "denied" (authorizeAdmin returning null) can't be
 *  confused with an identity. */
export interface AdminIdentity {
  adminId: string;
}

export async function authorizeAdmin(req: VercelRequest): Promise<AdminIdentity | null> {
  const adminId = await adminSessionPlayerId(req);
  return adminId ? { adminId } : null;
}

/** One row per admin mutation. `admin` is whatever authorizeAdmin resolved for the
 *  request, passed down explicitly from the route (no request-scoped globals). A null
 *  admin_id means either a retired shared-token action (before 2026-11-19, see the 0004
 *  migration's comment) or an owner-run maintenance script such as
 *  scripts/apply-wordlist-inactivation.ts (actions `wordlist_inactivate*`). Shared by every
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
