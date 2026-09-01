/**
 * Account data deletion (ROADMAP — "Privacy page + data deletion endpoint", the
 * non-numbered bullet sequenced no later than Batch 8).
 *
 * `DELETE /api/v1/me` removes the caller's player record and their personal data, and
 * detaches their games from them. It is deliberately a thin wrapper over one `DELETE FROM
 * players` — the existing foreign-key actions do the rest, and keeping the fan-out in the
 * schema (not here) means a future table that references `players` states its own
 * deletion behaviour at definition time:
 *
 *   ON DELETE CASCADE   — word_stats, word_reports, word_suggestions, daily_results,
 *                         player_achievements  → rows removed with the player
 *   ON DELETE SET NULL   — games.player_id, admin_audit_log.admin_id
 *                         → rows kept, association removed (games stay as anonymous
 *                           history — "anonymises games", per the roadmap bullet)
 *   no FK to players      — game_guesses, game_hints hang off games(id), so they follow
 *                           the (now anonymous) game row and are untouched
 *
 * Identity comes from the same signed anon cookie every other `/me` route uses; there is
 * no login to also tear down (Neon Auth linking is Batch 8). The response clears the
 * cookie so the next request mints a fresh, unrelated anonymous player.
 */
import { db } from "./db.js";
import type { Reply } from "./game.js";

/** Matches the attributes the dispatcher sets when it *mints* `bv_anon`, minus Max-Age —
 *  a browser only replaces/clears a cookie when the path and other attributes line up. */
const CLEAR_ANON_COOKIE =
  "bv_anon=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";

export async function deleteMe(playerId: string | null): Promise<Reply> {
  if (!playerId) {
    // Nothing to delete, but still clear whatever unparseable cookie was sent so a
    // client stuck with a bad token can recover by calling this.
    return {
      status: 200,
      body: { deleted: false },
      headers: { "Set-Cookie": CLEAR_ANON_COOKIE },
    };
  }

  const sql = db();
  const result = await sql`delete from players where id = ${playerId}`;

  return {
    status: 200,
    body: { deleted: result.count > 0 },
    headers: { "Set-Cookie": CLEAR_ANON_COOKIE },
  };
}
