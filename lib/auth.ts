/**
 * Anonymous device identity (ROADMAP Batch 2.1): a signed, HTTP-only cookie stands in for
 * a login. Neon's managed Better Auth has no anonymous-session plugin (see ROADMAP
 * architecture decision 4), so the API mints and verifies its own — a UUID plus an
 * HMAC-SHA256 tag over that UUID, so a client can hold the id but never forge a new one
 * without the server's secret. Pure functions on purpose: no req/res here, matching
 * lib/http.ts's split between HTTP concerns (api/) and logic (lib/).
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const ANON_COOKIE_NAME = "bv_anon";

function sign(secret: string, playerId: string): string {
  return createHmac("sha256", secret).update(playerId).digest("hex");
}

/** A fresh device identity: a new player id and the `<uuid>.<hmac>` value to cookie it in. */
export function mintIdentity(secret: string): { playerId: string; cookieValue: string } {
  const playerId = randomUUID();
  return { playerId, cookieValue: `${playerId}.${sign(secret, playerId)}` };
}

/** Pulls `bv_anon` out of a raw `Cookie` header and returns its player id, or null if the
 *  cookie is absent, malformed, or its tag doesn't match (tampered, or signed with a
 *  since-rotated secret). Split on the *last* dot: the uuid itself contains dots-as-hyphens
 *  only, but this keeps the parse robust either way. */
export function verifyIdentity(secret: string, cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;

  const raw = cookieHeader
    .split(";")
    .map((pair) => pair.trim())
    .find((pair) => pair.startsWith(`${ANON_COOKIE_NAME}=`))
    ?.slice(ANON_COOKIE_NAME.length + 1);
  if (!raw) return null;

  const dot = raw.lastIndexOf(".");
  if (dot < 0) return null;
  const playerId = raw.slice(0, dot);
  const tag = raw.slice(dot + 1);

  const expected = sign(secret, playerId);
  const a = Buffer.from(tag, "hex");
  const b = Buffer.from(expected, "hex");
  // Different-length buffers would throw in timingSafeEqual rather than compare false.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  return playerId;
}
