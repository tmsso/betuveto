/**
 * Thin adapter between Vercel's Node handlers and the game logic, which speaks in
 * { status, body } replies. Keeping the HTTP concerns here means api/ files carry no
 * logic worth testing and lib/game.ts can be tested without a server.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { Reply } from "./game.ts";

type Logic = (req: VercelRequest) => Promise<Reply>;

/**
 * Wrap a logic function as a Vercel handler: enforce the method, serialise the reply, and
 * turn an unexpected throw into a 500 without leaking the error to the client (it goes to
 * the function logs instead — a stack trace could disclose the target word).
 */
export function handler(method: "GET" | "POST", logic: Logic) {
  return async (req: VercelRequest, res: VercelResponse): Promise<void> => {
    if (req.method !== method) {
      res.setHeader("Allow", method);
      res.status(405).json({ detail: `Method ${req.method} not allowed.` });
      return;
    }
    try {
      const reply = await logic(req);
      res.status(reply.status).json(reply.body);
    } catch (error) {
      console.error(error);
      res.status(500).json({ detail: "Internal error." });
    }
  };
}

/** The `[id]` path segment. */
export function gameId(req: VercelRequest): string {
  const id = req.query.id;
  return Array.isArray(id) ? (id[0] ?? "") : (id ?? "");
}

/**
 * An integer query parameter. Returns `fallback` when absent, and NaN when present but
 * not an integer — which the caller rejects as a 422, rather than silently defaulting a
 * typo like `?target_length=seven` to 7.
 */
export function intQuery(req: VercelRequest, name: string, fallback: number): number {
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
