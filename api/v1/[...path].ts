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
import {
  getReviewQueue,
  reactivateWord,
  resolveReport,
  resolveSuggestion,
} from "../../lib/admin-queue.js";
import { getConfigList, updateConfigValue } from "../../lib/admin-config.js";
import {
  disqualifyGame,
  listLeaderboardEntries,
  renamePlayer,
  searchPlayers,
} from "../../lib/admin-players.js";
import { deleteWord, editWord, searchWords } from "../../lib/admin-words.js";
import { isAdminAuthorized } from "../../lib/admin.js";
import { mintIdentity, verifyIdentity } from "../../lib/auth.js";
import { DEFAULT_WORDLIST_CODE } from "../../lib/db.js";
import type { Reply } from "../../lib/game.js";
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

/** Wraps an admin logic function so every /api/v1/admin/* route enforces the token check
 *  the same way, in one place — no future admin route can add itself here and forget it. */
function requireAdmin(logic: (req: VercelRequest) => Promise<Reply>) {
  return (req: VercelRequest): Promise<Reply> => {
    if (!isAdminAuthorized(req)) {
      return Promise.resolve({ status: 401, body: { detail: "Invalid or missing admin token." } });
    }
    return logic(req);
  };
}

/** A path segment that's a plain non-negative integer, e.g. a `words.id` — undefined for
 *  anything else so the caller can 404 rather than hand a NaN to a bigint DB parameter. */
function parseId(segment: string | undefined): number | undefined {
  if (segment === undefined || !/^\d+$/.test(segment)) return undefined;
  return Number(segment);
}

function resolveReportRoute(wordId: number) {
  return async (req: VercelRequest): Promise<Reply> => {
    const decision = bodyField(req, "decision");
    if (decision !== "accept" && decision !== "reject") {
      return { status: 422, body: { detail: "decision must be 'accept' or 'reject'." } };
    }
    return resolveReport(wordId, decision);
  };
}

function resolveSuggestionRoute(suggestionId: number) {
  return async (req: VercelRequest): Promise<Reply> => {
    const decision = bodyField(req, "decision");
    if (decision !== "approve" && decision !== "reject") {
      return { status: 422, body: { detail: "decision must be 'approve' or 'reject'." } };
    }
    return resolveSuggestion(suggestionId, decision);
  };
}

function searchWordsRoute(req: VercelRequest) {
  return searchWords(stringQuery(req, "wordlist", DEFAULT_WORDLIST_CODE), stringQuery(req, "q", ""));
}

function searchPlayersRoute(req: VercelRequest) {
  return searchPlayers(stringQuery(req, "q", ""));
}

function listLeaderboardEntriesRoute(req: VercelRequest) {
  const length = intQuery(req, "length");
  return listLeaderboardEntries(
    stringQuery(req, "wordlist", DEFAULT_WORDLIST_CODE),
    Number.isNaN(length) ? undefined : length,
  );
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

  if (a === "admin") {
    if (segments.length === 2 && b === "queue") {
      return methodHandler({ GET: requireAdmin(() => getReviewQueue()) });
    }

    if (segments.length === 2 && b === "words") {
      return methodHandler({ GET: requireAdmin(searchWordsRoute) });
    }

    if (segments.length === 3 && b === "words") {
      const wordId = parseId(c);
      if (wordId === undefined) return undefined;
      return methodHandler({
        PATCH: requireAdmin((req) => editWord(wordId, bodyField(req, "word"))),
        DELETE: requireAdmin(() => deleteWord(wordId)),
      });
    }

    if (segments.length === 2 && b === "config") {
      return methodHandler({ GET: requireAdmin(() => getConfigList()) });
    }

    if (segments.length === 3 && b === "config") {
      if (c === undefined) return undefined;
      const key = c;
      return methodHandler({
        PATCH: requireAdmin((req) => updateConfigValue(key, bodyField(req, "value"))),
      });
    }

    if (segments.length === 2 && b === "players") {
      return methodHandler({ GET: requireAdmin(searchPlayersRoute) });
    }

    if (segments.length === 3 && b === "players") {
      if (c === undefined) return undefined;
      const playerId = c;
      return methodHandler({
        PATCH: requireAdmin((req) => renamePlayer(playerId, bodyField(req, "display_name"))),
      });
    }

    if (segments.length === 2 && b === "scores") {
      return methodHandler({ GET: requireAdmin(listLeaderboardEntriesRoute) });
    }

    if (segments.length === 4 && b === "games" && d === "disqualify") {
      if (c === undefined) return undefined;
      const gameId = c;
      return methodHandler({ POST: requireAdmin(() => disqualifyGame(gameId)) });
    }

    if (segments.length === 4 && b === "reports" && d === "resolve") {
      const wordId = parseId(c);
      if (wordId === undefined) return undefined;
      return methodHandler({ POST: requireAdmin(resolveReportRoute(wordId)) });
    }

    if (segments.length === 4 && b === "words" && d === "reactivate") {
      const wordId = parseId(c);
      if (wordId === undefined) return undefined;
      return methodHandler({ POST: requireAdmin(() => reactivateWord(wordId)) });
    }

    if (segments.length === 4 && b === "suggestions" && d === "resolve") {
      const suggestionId = parseId(c);
      if (suggestionId === undefined) return undefined;
      return methodHandler({ POST: requireAdmin(resolveSuggestionRoute(suggestionId)) });
    }

    return undefined;
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
