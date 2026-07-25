import type { VercelRequest } from "@vercel/node";
import { verifyIdentity } from "../../../lib/auth.js";
import { handler } from "../../../lib/http.js";
import { getMyStats } from "../../../lib/word-stats.js";

function playerId(req: VercelRequest): string | null {
  const secret = process.env.ANON_SESSION_SECRET;
  if (!secret) throw new Error("ANON_SESSION_SECRET is not set.");
  return verifyIdentity(secret, req.headers.cookie);
}

export default handler("GET", (req) => getMyStats(playerId(req)));
