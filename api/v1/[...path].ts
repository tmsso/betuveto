/**
 * Single catch-all dispatcher for the whole /api/v1 surface. Vercel Hobby caps a
 * deployment at 12 Serverless Functions; with one file per route (health, game/start,
 * game/[id]/*, words/[action], me/[action], scores/top) the project sat exactly at that
 * ceiling, blocking any new endpoint (Batch 4.2, Batch 5's admin routes). Routing on the
 * `path` segments here costs zero functions per new endpoint, at the price of doing by
 * hand what Vercel's file-based router used to do for us. This file only replaces that
 * routing layer — every handler below calls the exact same lib/ functions the old
 * per-route files did, and every external URL keeps working unchanged.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { mintIdentity, verifyIdentity } from "../../lib/auth.js";
import { DEFAULT_WORDLIST_CODE } from "../../lib/db.js";
import {
  getAvailableLengths,
  getPossibleCount,
  getPossibleWords,
  getState,
  getWordCount,
  giveUp,
  guess,
  healthCheck,
  rescramble,
  startGame,
} from "../../lib/game.js";
import { useHint } from "../../lib/hints.js";
import { bodyField, bodyWord, intQuery, methodHandler, stringQuery } from "../../lib/http.js";
import { getPreferredLength, setPreferredLength } from "../../lib/players.js";
import { getTopScores } from "../../lib/scores.js";
import { reportWord } from "../../lib/word-reports.js";
import { suggestWord } from "../../lib/word-suggestions.js";
import { getMyStats } from "../../lib/word-stats.js";
import { DEFAULT_TARGET_LENGTH } from "../../lib/words.js";

type VercelHandler = (req: VercelRequest, res: VercelResponse) => Promise<void>;

/**
 * Segments of the path under /api/v1/. The legacy /api/game/* and /api/words/* aliases
 * (vercel.json) rewrite into this route before it's matched, so req.url still shows the
 * client's original pre-rewrite path — it cannot be trusted here. The query param Vercel
 * injects from vercel.json's own "/api/v1/:path*" rewrite is authoritative instead: it
 * reflects the final matched destination regardless of how many rewrite hops preceded it.
 * (A now-dead codepath is worth knowing about if this ever breaks again: Vercel's *auto*-
 * generated route for a bare [...path].ts catch-all — used only if the vercel.json rewrite
 * below is ever removed — both caps at one path segment *and* names the query key "...path"
 * literally, ellipsis included, not "path". The explicit rewrite exists precisely to
 * override that broken auto-route with a correct multi-segment one.)
 */
function pathSegments(req: VercelRequest): string[] {
  const raw = req.query.path ?? req.query["...path"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value ? value.split("/").filter((segment) => segment.length > 0) : [];
}

function playerId(req: VercelRequest): string | null {
  const secret = process.env.ANON_SESSION_SECRET;
  if (!secret) throw new Error("ANON_SESSION_SECRET is not set.");
  return verifyIdentity(secret, req.headers.cookie);
}

// 400 days: the longest Max-Age Chrome/Firefox honour, so anything larger just gets
// silently clamped anyway (ROADMAP 2.1).
const ANON_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

function startGameRoute(req: VercelRequest) {
  const secret = process.env.ANON_SESSION_SECRET;
  if (!secret) throw new Error("ANON_SESSION_SECRET is not set.");

  let resolvedPlayerId = verifyIdentity(secret, req.headers.cookie);
  let setCookieHeader: string | undefined;
  if (!resolvedPlayerId) {
    const minted = mintIdentity(secret);
    resolvedPlayerId = minted.playerId;
    setCookieHeader =
      `bv_anon=${minted.cookieValue}; Path=/; HttpOnly; Secure; SameSite=Lax; ` +
      `Max-Age=${ANON_COOKIE_MAX_AGE_SECONDS}`;
  }

  return startGame(
    intQuery(req, "target_length", DEFAULT_TARGET_LENGTH),
    // No fallback: absent means "use the length-scaled default" (ROADMAP 2.3), which only
    // startGame can compute since it alone knows the (already-validated) target_length.
    intQuery(req, "duration_seconds"),
    resolvedPlayerId,
    setCookieHeader,
  );
}

function reportWordRoute(req: VercelRequest) {
  const secret = process.env.ANON_SESSION_SECRET;
  const reporterId = secret ? verifyIdentity(secret, req.headers.cookie) : null;
  const wordlistField = bodyField(req, "wordlist");
  const wordlistCode = typeof wordlistField === "string" ? wordlistField : DEFAULT_WORDLIST_CODE;
  return reportWord(reporterId, bodyField(req, "word"), wordlistCode, bodyField(req, "reason"));
}

function suggestWordRoute(req: VercelRequest) {
  const secret = process.env.ANON_SESSION_SECRET;
  const suggesterId = secret ? verifyIdentity(secret, req.headers.cookie) : null;
  const wordlistField = bodyField(req, "wordlist");
  const wordlistCode = typeof wordlistField === "string" ? wordlistField : DEFAULT_WORDLIST_CODE;
  return suggestWord(suggesterId, bodyField(req, "word"), wordlistCode);
}

function scoresTopRoute(req: VercelRequest) {
  const secret = process.env.ANON_SESSION_SECRET;
  // Missing secret degrades to "no personal best" rather than 500 — the leaderboard
  // itself needs no identity at all.
  const resolvedPlayerId = secret ? verifyIdentity(secret, req.headers.cookie) : null;

  return getTopScores(
    intQuery(req, "length", DEFAULT_TARGET_LENGTH),
    stringQuery(req, "wordlist", DEFAULT_WORDLIST_CODE),
    stringQuery(req, "period", "all"),
    resolvedPlayerId,
  );
}

function matchRoute(segments: string[]): VercelHandler | undefined {
  const [a, b, c, d] = segments;

  if (segments.length === 1 && a === "health") {
    return methodHandler({ GET: () => healthCheck() });
  }

  if (segments.length === 2 && a === "game" && b === "start") {
    return methodHandler({ POST: startGameRoute });
  }

  if (a === "game" && b !== undefined) {
    const id = b;
    if (segments.length === 2) {
      return methodHandler({ GET: () => getState(id) });
    }
    if (segments.length === 3) {
      switch (c) {
        case "guess":
          return methodHandler({ POST: (req) => guess(id, bodyWord(req)) });
        case "hint":
          return methodHandler({ POST: () => useHint(id) });
        case "give_up":
          return methodHandler({ POST: () => giveUp(id) });
        case "rescramble":
          return methodHandler({ POST: () => rescramble(id) });
        case "possible_words":
          return methodHandler({ GET: () => getPossibleWords(id) });
        default:
          return undefined;
      }
    }
    if (segments.length === 4 && c === "possible_words" && d === "count") {
      return methodHandler({ GET: () => getPossibleCount(id) });
    }
    return undefined;
  }

  if (segments.length === 2 && a === "words") {
    switch (b) {
      case "count":
        return methodHandler({ GET: () => getWordCount() });
      case "lengths":
        return methodHandler({ GET: () => getAvailableLengths() });
      case "report":
        return methodHandler({ POST: reportWordRoute });
      case "suggest":
        return methodHandler({ POST: suggestWordRoute });
      default:
        return undefined;
    }
  }

  if (segments.length === 2 && a === "me") {
    switch (b) {
      case "preferences":
        return methodHandler({
          GET: (req) => getPreferredLength(playerId(req)),
          PATCH: (req) => setPreferredLength(playerId(req), bodyField(req, "preferred_length")),
        });
      case "stats":
        return methodHandler({ GET: (req) => getMyStats(playerId(req)) });
      default:
        return undefined;
    }
  }

  if (segments.length === 2 && a === "scores" && b === "top") {
    return methodHandler({ GET: scoresTopRoute });
  }

  return undefined;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const route = matchRoute(pathSegments(req));
  if (!route) {
    res.status(404).json({ detail: "Not found." });
    return;
  }
  await route(req, res);
}
