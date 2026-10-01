/**
 * Multiplayer room lifecycle hooks (ROADMAP 7.2.3 / 7.2.4, design: docs/multiplayer.md §4).
 *
 * The only new logic rooms add to the game flow. Everything a member does in their own
 * game (guess, hint, rescramble, give up) is the ordinary single-player code path; these
 * functions only decide when the *room* is over and finish it:
 *   - expired  — the shared deadline passed (checked lazily on the next snapshot read),
 *   - all_done — every member's own game is terminal (give-up or personal full clear),
 *   - cleared  — co-op only: the union of everyone's finds covers the board (7.2.4).
 *
 * Depends only on lib/game-core.ts, so lib/game.ts can call in here without an import
 * cycle (see game-core.ts's header).
 */
import type { Sql } from "postgres";
import type { GameConfig } from "./config.js";
import { effectiveScore, finalizeExpiry, finalizeWordStats, loadGame } from "./game-core.js";

export type RoomEndReason = "cleared" | "all_done" | "expired";

/**
 * Ends a room exactly once. Race-safe the same way finalizeExpiry is: only the invocation
 * whose `status = 'playing'` UPDATE actually matches a row goes on to touch the member
 * games, so two members finishing the last word at the same instant can't both pay the
 * bonus. Returns true if this call was the one that finished the room.
 */
export async function finishRoom(
  sql: Sql,
  roomId: string,
  reason: RoomEndReason,
  config: GameConfig,
): Promise<boolean> {
  const [room] = await sql<{ ends_at: Date }[]>`
    update rooms
       set status = 'finished', ended_at = now(), end_reason = ${reason}, bonus_per_member = 0
     where id = ${roomId} and status = 'playing'
     returning ends_at
  `;
  if (!room) return false;

  const memberGameIds = await sql<{ id: string }[]>`select id from games where room_id = ${roomId}`;
  const games = (await Promise.all(memberGameIds.map((row) => loadGame(sql, row.id)))).filter(
    (game) => game !== null,
  );

  if (reason === "cleared") {
    // D2: the time bonus is split equally among the members still playing. (The design
    // doc's formula says "member_count"; a member who already gave up or personally
    // cleared the board is no longer playing and doesn't take a share, so the divisor is
    // the still-active count. Personal full clears keep their own personal bonus.)
    const now = new Date();
    const active = games.filter((game) => game.status === "active");
    const remainingSeconds = Math.max(0, Math.floor((room.ends_at.getTime() - now.getTime()) / 1000));
    const bonus =
      active.length > 0
        ? Math.floor((remainingSeconds * config.completion_bonus_multiplier) / active.length)
        : 0;
    for (const game of active) {
      const finalScore = effectiveScore(game.raw_guess_score, game.hint_cost_total) + bonus;
      const result = await sql`
        update games set status = 'finished', ended_at = now(), final_score = ${finalScore}
         where id = ${game.id} and status = 'active'
      `;
      if (result.count > 0) await finalizeWordStats(sql, game, config);
    }
    await sql`update rooms set bonus_per_member = ${bonus} where id = ${roomId}`;
  } else {
    // expired / all_done: any member game still marked active is past its (shared)
    // deadline by now or is already terminal; finalizeExpiry is a no-op for the rest.
    const now = new Date();
    for (const game of games) await finalizeExpiry(sql, game, now, config);
  }
  return true;
}

/** Lazy expiry, exactly like single-player: whoever reads the room after the shared
 *  deadline finishes it (docs/multiplayer.md §4 — no sweeper process). */
export async function expireRoomIfDue(
  sql: Sql,
  room: { id: string; status: string; ends_at: Date | null },
  config: GameConfig,
): Promise<boolean> {
  if (room.status !== "playing" || !room.ends_at || new Date() <= room.ends_at) return false;
  return finishRoom(sql, room.id, "expired", config);
}

/** After a member's own game ends (give-up or personal full clear): if nobody is still
 *  playing, the room is over. Both modes. */
export async function checkAllDone(sql: Sql, roomId: string, config: GameConfig): Promise<void> {
  const [{ live }] = await sql<{ live: number }[]>`
    select count(*)::int as live from games
     where room_id = ${roomId} and status = 'active' and ends_at > now()
  `;
  if (live === 0) await finishRoom(sql, roomId, "all_done", config);
}
