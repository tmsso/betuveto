/**
 * The per-player game-start cap (ROADMAP 16.8 (b), added in #146 without a test). The usage
 * query runs as its exact SQL text against an in-process Postgres (PGlite, as in
 * delete-me.test.ts); the decision functions are pure.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { START_CAP_USAGE_SQL, overStartCap, startCapApplies, type StartCapUsage } from "../lib/game.js";

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
let pg: PGlite;
let wordlistId: number;

beforeAll(async () => {
  pg = new PGlite();
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    await pg.exec(readFileSync(path.join(migrationsDir, file), "utf8"));
  }
  const existing = (await pg.query<{ id: number }>("select id from wordlists limit 1")).rows[0];
  wordlistId =
    existing?.id ??
    (await pg.query<{ id: number }>("insert into wordlists (code, name, alphabet) values ('hu', 'Magyar', 'AÁB') returning id"))
      .rows[0].id;
}, 60_000);

async function newPlayer(isCi = false): Promise<string> {
  return (await pg.query<{ id: string }>("insert into players (is_ci) values ($1) returning id", [isCi])).rows[0].id;
}

/** Inserts games for `playerId` that started `minutesAgo` minutes ago. */
async function startedGames(playerId: string, n: number, minutesAgo: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await pg.query(
      `insert into games (player_id, wordlist_id, target_word, scrambled_letters, target_length,
                          started_at, ends_at)
       values ($1, $2, 'ALMAFA', 'AAFLMA', 6, now() - make_interval(mins => $3),
               now() - make_interval(mins => $3) + interval '3 minutes')`,
      [playerId, wordlistId, minutesAgo],
    );
  }
}

async function usage(playerId: string): Promise<StartCapUsage> {
  return (await pg.query<StartCapUsage>(START_CAP_USAGE_SQL, [playerId])).rows[0];
}

describe("game-start cap: usage query", () => {
  it("counts only this player's games from the last hour", async () => {
    const me = await newPlayer();
    const other = await newPlayer();
    await startedGames(me, 3, 5);
    await startedGames(me, 2, 61); // older than an hour: not counted
    await startedGames(other, 4, 5);
    expect(await usage(me)).toEqual({ recent: 3, is_ci: false });
  });

  it("reports a CI player as CI", async () => {
    const ci = await newPlayer(true);
    await startedGames(ci, 2, 1);
    expect(await usage(ci)).toEqual({ recent: 2, is_ci: true });
  });

  it("returns zero and is_ci null for an unknown player", async () => {
    expect(await usage("00000000-0000-0000-0000-000000000000")).toEqual({ recent: 0, is_ci: null });
  });
});

describe("game-start cap: decision", () => {
  const prod = { freshIdentity: false, vercelEnv: "production" };

  it("refuses at the cap and allows one below it", () => {
    expect(overStartCap(120, { recent: 120, is_ci: false })).toBe(true);
    expect(overStartCap(120, { recent: 121, is_ci: false })).toBe(true);
    expect(overStartCap(120, { recent: 119, is_ci: false })).toBe(false);
  });

  it("never caps a CI player, and treats an unknown player as not CI", () => {
    expect(overStartCap(120, { recent: 500, is_ci: true })).toBe(false);
    expect(overStartCap(120, { recent: 120, is_ci: null })).toBe(true);
  });

  it("applies on production and locally, for an existing identity", () => {
    expect(startCapApplies(120, prod)).toBe(true);
    expect(startCapApplies(120, { freshIdentity: false, vercelEnv: undefined })).toBe(true);
  });

  it("a cap of 0 (or below) switches it off", () => {
    expect(startCapApplies(0, prod)).toBe(false);
    expect(startCapApplies(-1, prod)).toBe(false);
  });

  it("skips a just-minted identity and previews", () => {
    expect(startCapApplies(120, { ...prod, freshIdentity: true })).toBe(false);
    expect(startCapApplies(120, { freshIdentity: false, vercelEnv: "preview" })).toBe(false);
  });

  it("end to end: the 120th start in an hour is refused, the 119th is not", async () => {
    const p = await newPlayer();
    await startedGames(p, 119, 10);
    expect(overStartCap(120, await usage(p))).toBe(false);
    await startedGames(p, 1, 10);
    expect(overStartCap(120, await usage(p))).toBe(true);
  });
});
