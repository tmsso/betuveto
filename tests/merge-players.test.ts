/**
 * ROADMAP 8.1 — merge_players() (migrations/0028) against a real Postgres, in-process.
 * PGlite is Postgres compiled to WebAssembly: every migration is applied to a fresh
 * in-memory database, so this needs no Docker, no Neon branch and no network.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
let pg: PGlite;

async function one<T>(query: string, params: unknown[] = []): Promise<T> {
  return (await pg.query<T>(query, params)).rows[0] as T;
}

async function newPlayer(name: string | null = null): Promise<string> {
  return (await one<{ id: string }>(
    "insert into players (display_name) values ($1) returning id", [name],
  )).id;
}

async function newGame(playerId: string, wordlistId: number): Promise<string> {
  return (await one<{ id: string }>(
    `insert into games (player_id, wordlist_id, target_word, scrambled_letters, target_length, ends_at)
     values ($1, $2, 'KAPUK', 'PUKKA', 5, now()) returning id`, [playerId, wordlistId],
  )).id;
}

beforeAll(async () => {
  pg = new PGlite();
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    await pg.exec(readFileSync(path.join(migrationsDir, file), "utf8"));
  }
}, 60_000);

describe("merge_players", () => {
  it("re-points history, sums word stats, unions achievements and deletes the source", async () => {
    const wl = (await one<{ id: number }>("select id from wordlists where code = 'hu'"))?.id
      ?? (await one<{ id: number }>(
        "insert into wordlists (code, name, alphabet) values ('hu', 'Magyar', 'A') returning id",
      )).id;
    const into = await newPlayer(null);
    const from = await newPlayer("Anna");
    await newGame(into, wl);
    const fromGame = await newGame(from, wl);

    await pg.query(
      `insert into word_stats (player_id, wordlist_id, word, times_failed, times_solved, last_failed_game_seq)
       values ($1, $3, 'ALMA', 1, 2, 5), ($2, $3, 'ALMA', 3, 4, 9), ($2, $3, 'LÓ', 0, 1, null)`,
      [into, from, wl],
    );
    await pg.query(
      `insert into player_achievements (player_id, achievement_key, unlocked_at)
       values ($1, 'first_word', '2026-11-05'), ($2, 'first_word', '2026-11-01'), ($2, 'ten_games', now())`,
      [into, from],
    );

    await pg.query("select merge_players($1, $2)", [from, into]);

    expect(await one("select count(*)::int as n from players where id = $1", [from])).toEqual({ n: 0 });
    expect(await one("select player_id from games where id = $1", [fromGame])).toEqual({ player_id: into });
    expect(await one("select count(*)::int as n from games where player_id = $1", [into])).toEqual({ n: 2 });

    const stats = (await pg.query(
      "select word, times_failed, times_solved, last_failed_game_seq from word_stats where player_id = $1 order by word",
      [into],
    )).rows;
    expect(stats).toEqual([
      { word: "ALMA", times_failed: 4, times_solved: 6, last_failed_game_seq: 9 },
      { word: "LÓ", times_failed: 0, times_solved: 1, last_failed_game_seq: null },
    ]);

    const ach = (await pg.query<{ achievement_key: string; unlocked_at: Date }>(
      "select achievement_key, unlocked_at from player_achievements where player_id = $1 order by achievement_key",
      [into],
    )).rows;
    expect(ach.map((a) => a.achievement_key)).toEqual(["first_word", "ten_games"]);
    expect(ach[0]!.unlocked_at.toISOString().slice(0, 10)).toBe("2026-11-01");

    // A missing display name is filled from the source.
    expect(await one("select display_name from players where id = $1", [into])).toEqual({ display_name: "Anna" });
  });

  it("keeps the target's row when both played the same daily puzzle", async () => {
    const wl = (await one<{ id: number }>("select id from wordlists where code = 'hu'")).id;
    const into = await newPlayer("Bea");
    const from = await newPlayer("Cili");
    const puzzle = (await one<{ id: number }>(
      `insert into daily_puzzles (puzzle_date, wordlist_id, target_length, target_word, scrambled_letters, possible_count)
       values ('2026-11-09', $1, 5, 'KAPUK', 'PUKKA', 3) returning id`, [wl],
    )).id;
    const g1 = await newGame(into, wl);
    const g2 = await newGame(from, wl);
    await pg.query(
      `insert into daily_results (puzzle_id, player_id, game_id, completed, final_score)
       values ($1, $2, $3, true, 50), ($1, $4, $5, false, 10)`,
      [puzzle, into, g1, from, g2],
    );

    await pg.query("select merge_players($1, $2)", [from, into]);

    const rows = (await pg.query("select final_score from daily_results where puzzle_id = $1", [puzzle])).rows;
    expect(rows).toEqual([{ final_score: 50 }]);
    // The target keeps its own name.
    expect(await one("select display_name from players where id = $1", [into])).toEqual({ display_name: "Bea" });
  });

  it("is a no-op when both ids are the same player", async () => {
    const p = await newPlayer("Dóra");
    await pg.query("select merge_players($1, $1)", [p]);
    expect(await one("select count(*)::int as n from players where id = $1", [p])).toEqual({ n: 1 });
  });
});
