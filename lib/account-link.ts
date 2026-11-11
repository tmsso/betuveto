/**
 * Google sign-in as an optional identity upgrade (ROADMAP Batch 8.1). Anonymous play is
 * unchanged; signing in links the device's player to a Neon Auth user (`players.auth_user_id`,
 * migrations/0008) so another device can resolve to the same player.
 *
 * The caller has already verified the Neon Auth JWT (lib/neon-auth.ts) — this only decides
 * which player the device should be on afterwards. `players` stores only the opaque Neon
 * user id. The Google name, email and picture URL do live in this database, but in Neon
 * Auth's own `neon_auth` tables, which the game never reads; "Delete my data" removes that
 * user too (lib/account.ts).
 */
import { db } from "./db.js";

export type LinkOutcome =
  /** The device's own player was unlinked and is now linked to this account. */
  | "linked"
  /** The device was already on this account's player. */
  | "already_linked"
  /** Another player owns this account: the device's anonymous player was merged into it. */
  | "merged"
  /** Another player owns this account; the device's player belongs to a different account,
   *  so nothing is merged — the device just switches over. */
  | "switched"
  /** No player owns this account and the device's player can't take it: a fresh one is
   *  created for it. */
  | "created";

export type LinkPlan =
  | { outcome: "linked" | "already_linked"; playerId: string }
  | { outcome: "merged"; playerId: string; mergeFrom: string }
  | { outcome: "switched"; playerId: string }
  | { outcome: "created" };

/** A phone with this many finished games is probably someone's real history, not a quick
 *  try — merging it into a Google account then needs an explicit yes (a tester signing in
 *  on a friend's phone would otherwise take the friend's games, with no undo). */
export const MERGE_CONFIRM_MIN_GAMES = 10;

export function needsMergeConfirmation(deviceGames: number, confirmed: boolean): boolean {
  return !confirmed && deviceGames >= MERGE_CONFIRM_MIN_GAMES;
}

/** The decision alone, as a pure function so every branch is unit-testable.
 *  `device` is the cookie's player (null when there is none), `owner` the player that
 *  already carries this auth user id (null when none does). */
export function planLink(
  device: { id: string; authUserId: string | null } | null,
  owner: { id: string } | null,
): LinkPlan {
  if (owner) {
    if (device?.id === owner.id) return { outcome: "already_linked", playerId: owner.id };
    if (device && device.authUserId === null) {
      return { outcome: "merged", playerId: owner.id, mergeFrom: device.id };
    }
    return { outcome: "switched", playerId: owner.id };
  }
  if (device && device.authUserId === null) return { outcome: "linked", playerId: device.id };
  return { outcome: "created" };
}

/** Applies the plan. Returns the player the device should now carry in its cookie. */
export async function linkAccount(
  devicePlayerId: string | null,
  authUserId: string,
  confirmMerge = false,
): Promise<
  | { outcome: LinkOutcome; playerId: string }
  | { outcome: "confirm_merge"; deviceGames: number }
> {
  const sql = db();
  return sql.begin(async (tx) => {
    const [owner] = await tx<{ id: string }[]>`
      select id from players where auth_user_id = ${authUserId} for update
    `;
    const [device] = devicePlayerId
      ? await tx<{ id: string; auth_user_id: string | null }[]>`
          select id, auth_user_id from players where id = ${devicePlayerId} for update
        `
      : [];
    const plan = planLink(
      device ? { id: device.id, authUserId: device.auth_user_id } : null,
      owner ?? null,
    );

    switch (plan.outcome) {
      case "linked":
        await tx`update players set auth_user_id = ${authUserId} where id = ${plan.playerId}`;
        return { outcome: plan.outcome, playerId: plan.playerId };
      case "merged": {
        const [{ n }] = await tx<{ n: number }[]>`
          select count(*)::int as n from games
          where player_id = ${plan.mergeFrom} and status <> 'active'
        `;
        if (needsMergeConfirmation(n, confirmMerge)) {
          return { outcome: "confirm_merge" as const, deviceGames: n };
        }
        await tx`select merge_players(${plan.mergeFrom}::uuid, ${plan.playerId}::uuid)`;
        return { outcome: plan.outcome, playerId: plan.playerId };
      }
      case "already_linked":
      case "switched":
        return { outcome: plan.outcome, playerId: plan.playerId };
      case "created": {
        const [row] = await tx<{ id: string }[]>`
          insert into players (auth_user_id) values (${authUserId}) returning id
        `;
        return { outcome: plan.outcome, playerId: row!.id };
      }
    }
  });
}

/** Whether the device's player is linked to a Google (Neon Auth) account — shown in Settings. */
export async function isLinked(playerId: string | null): Promise<boolean> {
  if (!playerId) return false;
  const [row] = await db()<{ linked: boolean }[]>`
    select auth_user_id is not null as linked from players where id = ${playerId}
  `;
  return row?.linked ?? false;
}
