/**
 * In-app tester feedback (ROADMAP 12.7): a player posts a short message from the help
 * dialog; the admin lists and resolves them. Replaces 12.5's mailto link, which had to
 * publish the receiving address in the served bundle.
 *
 * The free-identity abuse path (ROADMAP 12.6) applies here too: the route mints through
 * the same throttled resolveOrMintIdentity as game/start, and each player is capped at
 * MAX_FEEDBACK_PER_DAY, so one script can't flood the table from one address.
 */
import { type AdminIdentity, logAdminAction } from "./admin.js";
import { db } from "./db.js";
import type { Reply } from "./game.js";

export const MAX_FEEDBACK_LENGTH = 2000;
const MAX_FEEDBACK_PER_DAY = 5;
const LIST_LIMIT = 100;

/** Postgres "undefined_table": the 0023 migration hasn't run on this database yet. */
const UNDEFINED_TABLE = "42P01";
const UNAVAILABLE: Reply = { status: 503, body: { detail: "feedback_unavailable" } };

function isMissingTable(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === UNDEFINED_TABLE;
}

/** Optional context strings are stored truncated, never rejected: they're diagnostics
 *  the client fills in on its own, and a long URL shouldn't cost a tester their message. */
function context(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 ? value.slice(0, max) : null;
}

export interface FeedbackContext {
  page_url?: unknown;
  user_agent?: unknown;
  ui_language?: unknown;
}

export async function submitFeedback(
  playerId: string,
  rawMessage: unknown,
  ctx: FeedbackContext,
): Promise<Reply> {
  if (typeof rawMessage !== "string") {
    return { status: 422, body: { detail: "message must be a string." } };
  }
  const message = rawMessage.trim();
  if (message.length === 0 || message.length > MAX_FEEDBACK_LENGTH) {
    return {
      status: 422,
      body: { detail: `message must be 1-${MAX_FEEDBACK_LENGTH} characters.` },
    };
  }

  const sql = db();
  try {
    // A freshly minted identity has no players row yet (game/start creates it the same way).
    await sql`insert into players (id) values (${playerId}) on conflict do nothing`;
    const [row] = await sql<{ id: string }[]>`
      insert into feedback (player_id, message, page_url, user_agent, ui_language)
      values (${playerId}, ${message}, ${context(ctx.page_url, 500)},
              ${context(ctx.user_agent, 300)}, ${context(ctx.ui_language, 10)})
      returning id
    `;

    // Insert-then-count-then-undo, like lib/word-suggestions.ts: counting first would let
    // concurrent requests all read "under the limit" before any of them inserts.
    const [{ count }] = await sql<{ count: number }[]>`
      select count(*)::int as count from feedback
       where player_id = ${playerId} and created_at >= now() - interval '1 day'
    `;
    if (count > MAX_FEEDBACK_PER_DAY) {
      await sql`delete from feedback where id = ${row.id}`;
      return { status: 429, body: { detail: "rate_limited" } };
    }
  } catch (error) {
    if (isMissingTable(error)) return UNAVAILABLE;
    throw error;
  }

  return { status: 200, body: { sent: true } };
}

/** Admin list, newest first. `open` (the default) hides resolved items. */
export async function listFeedback(status: string): Promise<Reply> {
  const sql = db();
  const onlyOpen = status !== "all";
  try {
    const rows = await sql`
      select f.id, f.message, f.page_url, f.user_agent, f.ui_language, f.created_at,
             f.resolved_at, f.player_id, p.display_name, p.is_ci
        from feedback f
        join players p on p.id = f.player_id
       where ${onlyOpen ? sql`f.resolved_at is null` : sql`true`}
       order by f.created_at desc
       limit ${LIST_LIMIT}
    `;
    const [{ open }] = await sql<{ open: number }[]>`
      select count(*)::int as open from feedback where resolved_at is null
    `;
    return { status: 200, body: { feedback: rows, open_count: open } };
  } catch (error) {
    if (isMissingTable(error)) return UNAVAILABLE;
    throw error;
  }
}

export async function resolveFeedback(admin: AdminIdentity, feedbackId: number): Promise<Reply> {
  const sql = db();
  try {
    const [row] = await sql<{ id: string; resolved_at: string }[]>`
      update feedback set resolved_at = coalesce(resolved_at, now())
       where id = ${feedbackId}
      returning id, resolved_at
    `;
    if (!row) return { status: 404, body: { detail: "Unknown feedback." } };
    await logAdminAction(admin, "resolve_feedback", { feedback_id: feedbackId });
    return { status: 200, body: { id: feedbackId, resolved_at: row.resolved_at } };
  } catch (error) {
    if (isMissingTable(error)) return UNAVAILABLE;
    throw error;
  }
}
