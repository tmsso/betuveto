/**
 * Consolidates count/lengths/report into one function — Vercel Hobby caps a deployment
 * at 12 Serverless Functions, and three separate files for these would have pushed the
 * project over that ceiling the moment word-report (ROADMAP 4.1) landed. `[action]`
 * plays the same role a `?action=` query param would; it's a route-file trick, not a
 * meaningful "resource".
 */
import type { VercelRequest } from "@vercel/node";
import { verifyIdentity } from "../../../lib/auth.js";
import { DEFAULT_WORDLIST_CODE } from "../../../lib/db.js";
import { getAvailableLengths, getWordCount } from "../../../lib/game.js";
import { bodyField, methodHandler } from "../../../lib/http.js";
import { reportWord } from "../../../lib/word-reports.js";

function action(req: VercelRequest): string {
  const value = req.query.action;
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

const NOT_FOUND = { status: 404, body: { detail: "Not found." } };

export default methodHandler({
  GET: (req) => {
    switch (action(req)) {
      case "count":
        return getWordCount();
      case "lengths":
        return getAvailableLengths();
      default:
        return Promise.resolve(NOT_FOUND);
    }
  },
  POST: (req) => {
    if (action(req) !== "report") return Promise.resolve(NOT_FOUND);

    const secret = process.env.ANON_SESSION_SECRET;
    const playerId = secret ? verifyIdentity(secret, req.headers.cookie) : null;
    const wordlistField = bodyField(req, "wordlist");
    const wordlistCode = typeof wordlistField === "string" ? wordlistField : DEFAULT_WORDLIST_CODE;

    return reportWord(playerId, bodyField(req, "word"), wordlistCode, bodyField(req, "reason"));
  },
});
