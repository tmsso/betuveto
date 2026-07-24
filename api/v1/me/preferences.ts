import type { VercelRequest } from "@vercel/node";
import { verifyIdentity } from "../../../lib/auth.js";
import { bodyField, methodHandler } from "../../../lib/http.js";
import { getPreferredLength, setPreferredLength } from "../../../lib/players.js";

/** The requesting player, from the same signed `bv_anon` cookie game/start uses — null
 *  for a first-ever visitor (no cookie minted yet) or a tampered/expired one. */
function playerId(req: VercelRequest): string | null {
  const secret = process.env.ANON_SESSION_SECRET;
  if (!secret) throw new Error("ANON_SESSION_SECRET is not set.");
  return verifyIdentity(secret, req.headers.cookie);
}

export default methodHandler({
  GET: (req) => getPreferredLength(playerId(req)),
  PATCH: (req) => setPreferredLength(playerId(req), bodyField(req, "preferred_length")),
});
