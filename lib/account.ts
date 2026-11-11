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
 *                         player_achievements, feedback (12.7)  → rows removed with the player
 *   ON DELETE SET NULL   — games.player_id, admin_audit_log.admin_id
 *                         → rows kept, association removed (games stay as anonymous
 *                           history — "anonymises games", per the roadmap bullet)
 *   no FK to players      — game_guesses, game_hints hang off games(id), so they follow
 *                           the (now anonymous) game row and are untouched
 *
 * Google sign-in (Batch 8.1): when the player is linked to a Neon Auth user, that user is
 * deleted in the same statement. Neon Auth keeps its users (Google name, email, picture
 * URL) in the `neon_auth` schema of this same database, and its `session` and `account`
 * rows cascade from `neon_auth."user"`, so the sign-in is gone too, not only our link to
 * it. Play requires this once a player can create an account in the app.
 *
 * Admin players are refused (409): the admin's Magic Link login and their Google sign-in
 * are one Neon Auth user, so a stray tap while testing on a phone would wipe the admin
 * flag and the admin login together. An admin is removed by hand instead.
 *
 * Identity comes from the same signed anon cookie every other `/me` route uses. The
 * response clears the cookie so the next request mints a fresh, unrelated anonymous player.
 */
import { db } from "./db.js";
import type { Reply } from "./game.js";

/** Matches the attributes the dispatcher sets when it *mints* `bv_anon`, minus Max-Age —
 *  a browser only replaces/clears a cookie when the path and other attributes line up. */
const CLEAR_ANON_COOKIE =
  "bv_anon=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";

/** One statement, so the player and its sign-in go together or not at all. Plain SQL with a
 *  `$1` placeholder so tests/delete-me.test.ts runs this exact text on PGlite.
 *  `auth_user_id` is text while Neon Auth's `id` is a uuid, hence the cast. The snapshot
 *  sees the rows as they were before the deletes, so `admin` reports the refused case.
 *  `withSignIn` is false on a database without the `neon_auth` schema (a branch where Neon
 *  Auth was never set up): referencing a missing table would fail the whole deletion. */
export function deletePlayerSql(withSignIn: boolean): string {
  const signIn = withSignIn
    ? `delete from neon_auth."user" u using gone
        where gone.auth_user_id is not null and u.id::text = gone.auth_user_id
       returning 1`
    : `select 1 where false`;
  return `
    with gone as (
      delete from public.players where id = $1 and not is_admin returning auth_user_id
    ), sign_in as (
      ${signIn}
    )
    select (select count(*) from gone)::int as deleted,
           (select count(*) from sign_in)::int as sign_ins_deleted,
           exists (select 1 from public.players where id = $1 and is_admin) as admin
  `;
}

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
  const [{ has_neon_auth }] = await sql<{ has_neon_auth: boolean }[]>`
    select to_regclass('neon_auth."user"') is not null as has_neon_auth
  `;
  const [row] = await sql.unsafe<{ deleted: number; sign_ins_deleted: number; admin: boolean }[]>(
    deletePlayerSql(has_neon_auth), [playerId],
  );
  if (row?.admin) return { status: 409, body: { detail: "admin_account" } };

  return {
    status: 200,
    body: { deleted: (row?.deleted ?? 0) > 0 },
    headers: { "Set-Cookie": CLEAR_ANON_COOKIE },
  };
}
