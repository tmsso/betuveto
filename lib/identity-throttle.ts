/**
 * Identity-mint throttle (ROADMAP 12.6). Player identity is a free anonymous cookie, so
 * without a cap one script could mint unlimited `players` rows (free-tier storage) or
 * farm identities to get around every per-player limit. This caps *fresh* identities per
 * client address per hour; players who already have a cookie are never affected.
 *
 * Privacy: the address is HMAC'd with ANON_SESSION_SECRET before it touches the database
 * (migrations/0021), and rows older than 24 h are purged on every write.
 *
 * Fails open: a missing table (migration not applied yet) or any DB error lets the mint
 * through and logs it, since a throttle outage must never block real players.
 */
import { createHmac } from "node:crypto";
import type { VercelRequest } from "@vercel/node";
import { getConfig } from "./config.js";
import { db } from "./db.js";
import { log, serializeError } from "./log.js";

/** The client address as Vercel reports it. Vercel's edge overwrites these headers, so
 *  on a deployment they can't be spoofed by the client. Null locally / when absent. */
export function clientAddress(req: VercelRequest): string | null {
  const header = (name: string) => {
    const value = req.headers[name];
    return (Array.isArray(value) ? value[0] : value)?.trim() || null;
  };
  return header("x-real-ip") ?? header("x-forwarded-for")?.split(",")[0].trim() ?? null;
}

/** true = allowed to mint; false = over the per-address cap (caller answers 429). */
export async function allowIdentityMint(req: VercelRequest): Promise<boolean> {
  const secret = process.env.ANON_SESSION_SECRET;
  const address = clientAddress(req);
  if (!secret || !address) return true;

  const { identity_mints_per_ip_per_hour: cap } = await getConfig();
  if (cap <= 0) return true; // 0 disables the throttle

  const ipHash = createHmac("sha256", secret).update(address).digest("hex");
  const sql = db();
  try {
    await sql`delete from identity_mints where created_at < now() - interval '24 hours'`;
    // Insert-then-count, like the other rate limits here (lib/game.ts guess()): counting
    // first would let a burst of parallel requests all read "under the cap".
    const [inserted] = await sql<{ id: number }[]>`
      insert into identity_mints (ip_hash) values (${ipHash}) returning id
    `;
    const [{ recent }] = await sql<{ recent: number }[]>`
      select count(*)::int as recent from identity_mints
       where ip_hash = ${ipHash} and created_at >= now() - interval '1 hour'
    `;
    if (recent > cap) {
      await sql`delete from identity_mints where id = ${inserted.id}`;
      log.warn("identity_mint_throttled", { recent, cap });
      return false;
    }
    return true;
  } catch (error) {
    log.error("identity_mint_throttle_failed", serializeError(error));
    return true;
  }
}
