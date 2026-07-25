/**
 * Consolidates preferences/stats into one function — same reasoning as
 * api/v1/words/[action].ts: Vercel Hobby caps a deployment at 12 Serverless Functions.
 */
import type { VercelRequest } from "@vercel/node";
import { verifyIdentity } from "../../../lib/auth.js";
import { bodyField, methodHandler } from "../../../lib/http.js";
import { getPreferredLength, setPreferredLength } from "../../../lib/players.js";
import { getMyStats } from "../../../lib/word-stats.js";

function action(req: VercelRequest): string {
  const value = req.query.action;
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function playerId(req: VercelRequest): string | null {
  const secret = process.env.ANON_SESSION_SECRET;
  if (!secret) throw new Error("ANON_SESSION_SECRET is not set.");
  return verifyIdentity(secret, req.headers.cookie);
}

const NOT_FOUND = { status: 404, body: { detail: "Not found." } };

export default methodHandler({
  GET: (req) => {
    switch (action(req)) {
      case "preferences":
        return getPreferredLength(playerId(req));
      case "stats":
        return getMyStats(playerId(req));
      default:
        return Promise.resolve(NOT_FOUND);
    }
  },
  PATCH: (req) => {
    if (action(req) !== "preferences") return Promise.resolve(NOT_FOUND);
    return setPreferredLength(playerId(req), bodyField(req, "preferred_length"));
  },
});
