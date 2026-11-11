/**
 * Thin adapter between Vercel's Node handlers and the game logic, which speaks in
 * { status, body } replies. Keeping the HTTP concerns here means api/ files carry no
 * logic worth testing and lib/game.ts can be tested without a server.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Reply } from "./game.js";
import { log, serializeError } from "./log.js";
import { captureException } from "./observability.js";

type Logic = (req: VercelRequest) => Promise<Reply>;
type Method = "GET" | "POST" | "PATCH" | "DELETE";

/**
 * Dispatch to one logic function per HTTP method, serialise the reply, and turn an
 * unexpected throw into a 500 without leaking the error to the client (it goes to the
 * function logs instead — a stack trace could disclose the target word). Routes that need
 * e.g. GET *and* PATCH on the same path (/me/preferences) pass both.
 */
export function methodHandler(routes: Partial<Record<Method, Logic>>) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    const logic = req.method ? routes[req.method as Method] : undefined;
    if (!logic) {
      res.setHeader("Allow", Object.keys(routes).join(", "));
      res.status(405).json({ detail: `Method ${req.method} not allowed.` });
      return;
    }
    try {
      const reply = await logic(req);
      for (const [name, value] of Object.entries(reply.headers ?? {})) {
        res.setHeader(name, value);
      }
      res.status(reply.status).json(reply.body);
    } catch (error) {
      // ROADMAP Batch 10 item 9: every unexpected throw in the whole /api/v1 surface
      // lands here. Structured line always; Sentry too when SENTRY_DSN is configured
      // (a no-op otherwise). The client still gets only a bare "Internal error." — a
      // stack trace could disclose the target word.
      log.error("unhandled_route_error", {
        method: req.method,
        url: req.url,
        ...serializeError(error),
      });
      await captureException(error, { method: req.method, url: req.url });
      res.status(500).json({ detail: "Internal error." });
    }
  };
}

/**
 * Should this request be refused as a cross-site write? (Pre-Play hardening, 2026-11.)
 *
 * The identity cookie is SameSite=Lax, which stops other *sites* from sending it on a POST
 * but not other *subdomains of the same site*: a page on any other *.tmsso.com host counts
 * as same-site and could fire a body-less POST (give up, leave room, sign out) with the
 * player's cookie attached. Browsers label every request with `Sec-Fetch-Site`; the game's
 * own pages always send `same-origin` (`none` = typed/bookmarked navigation).
 *
 * Deliberately lenient where the header is missing: non-browser clients (the contract
 * suite, curl) don't send it and carry no ambient cookie to abuse, and a very old browser
 * falls back to comparing `Origin` with the host it called.
 */
export function isCrossSiteWrite(req: Pick<VercelRequest, "method" | "headers">): boolean {
  if (!req.method || ["GET", "HEAD", "OPTIONS"].includes(req.method)) return false;
  const header = (name: string) => {
    const value = req.headers[name];
    return (Array.isArray(value) ? value[0] : value)?.trim() || undefined;
  };
  const site = header("sec-fetch-site");
  if (site) return site !== "same-origin" && site !== "none";
  const origin = header("origin");
  if (!origin) return false;
  const host = header("x-forwarded-host") ?? header("host");
  try {
    return new URL(origin).host !== host;
  } catch {
    return true; // "null" or malformed Origin on a write: not one of ours
  }
}

/**
 * An integer query parameter. Returns `fallback` when absent (or, with no fallback given,
 * `undefined` — used where "absent" and "explicitly provided" must be told apart, e.g.
 * game/start's duration_seconds, whose default depends on target_length), and NaN when
 * present but not an integer — which the caller rejects as a 422, rather than silently
 * defaulting a typo like `?target_length=seven` to 7.
 */
export function intQuery(req: VercelRequest, name: string): number | undefined;
export function intQuery(req: VercelRequest, name: string, fallback: number): number;
export function intQuery(
  req: VercelRequest,
  name: string,
  fallback?: number,
): number | undefined {
  const raw = req.query[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === "") return fallback;
  return /^-?\d+$/.test(value) ? Number(value) : NaN;
}

/** The guessed word from a JSON body. Vercel parses `application/json` for us. */
export function bodyWord(req: VercelRequest): string {
  const body = req.body as { word?: unknown } | undefined;
  return typeof body?.word === "string" ? body.word : "";
}

/** One named field out of a JSON body, untyped — callers validate their own shape (e.g.
 *  preferences.ts's PATCH, which needs to tell "absent" apart from "present but wrong
 *  type" for its own 422 message). */
export function bodyField(req: VercelRequest, name: string): unknown {
  const body = req.body as Record<string, unknown> | undefined;
  return body?.[name];
}

/** A string query parameter, falling back when absent (e.g. `?wordlist=hu`). */
export function stringQuery(req: VercelRequest, name: string, fallback: string): string {
  const raw = req.query[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === undefined || value === "" ? fallback : value;
}
