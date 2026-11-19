/**
 * ROADMAP 16.9 Step 2: the inactivation script's pure parts, and its exact SQL text run on
 * PGlite (as in delete-me.test.ts) against the cases it must respect.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import {
  DRY_RUN_SQL,
  INACTIVATE_SQL,
  REACTIVATE_SQL,
  batches,
  parseArgs,
  parseList,
} from "../scripts/apply-wordlist-inactivation.js";

describe("parseList / batches / parseArgs", () => {
  it("normalises, de-duplicates, skips comments and reports non-words", () => {
    const { words, invalid } = parseList("# header\nalma\nALMA\n\nCelsius-fok\nkörte\n");
    expect(words).toEqual(["ALMA", "KÖRTE"]);
    expect(invalid).toEqual(["Celsius-fok"]);
  });

  it("splits into batches of the given size", () => {
    expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(batches([], 2)).toEqual([]);
  });

  it("defaults to a dry run and needs a file", () => {
    expect(parseArgs(["list.txt"])).toMatchObject({ file: "list.txt", code: "hu", mode: "dry-run" });
    expect(parseArgs(["list.txt", "--apply", "--confirm-host", "h"])).toMatchObject({ mode: "apply", confirmHost: "h" });
    expect(() => parseArgs(["--apply"])).toThrow(/word list file/);
    expect(() => parseArgs(["l.txt", "--force"])).toThrow(/Unknown option/);
  });
});

describe("inactivation SQL", () => {
  const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
  let pg: PGlite;
  let hu: number;
  let en: number;

  const active = async (wl: number, word: string) =>
    (await pg.query<{ active: boolean }>("select active from words where wordlist_id = $1 and word = $2", [wl, word])).rows[0]?.active;

  beforeAll(async () => {
    pg = new PGlite();
    for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
      await pg.exec(readFileSync(path.join(migrationsDir, file), "utf8"));
    }
    const wl = async (code: string) =>
      (await pg.query<{ id: number }>(`select id from wordlists where code = $1`, [code])).rows[0]?.id ??
      (await pg.query<{ id: number }>(`insert into wordlists (code, name, alphabet) values ($1, $1, 'ABC') returning id`, [code])).rows[0].id;
    hu = await wl("hu");
    en = await wl("en");
    const add = (wlId: number, word: string, opts: { active?: boolean; source?: string } = {}) =>
      pg.query(
        "insert into words (wordlist_id, word, length, signature, active, source) values ($1, $2, $3, $2, $4, $5)",
        [wlId, word, Array.from(word).length, opts.active ?? true, opts.source ?? "original"],
      );
    await add(hu, "THOMAS");
    await add(hu, "AVENUE");
    await add(hu, "INGAME"); // target of an active game
    await add(hu, "DAILYW"); // today's daily target
    await add(hu, "SUGGES", { source: "suggested" });
    await add(hu, "ALREADY", { active: false }); // inactive before (e.g. a report)
    await add(en, "THOMAS"); // same text, other wordlist
    await pg.query(
      `insert into games (wordlist_id, target_word, scrambled_letters, target_length, ends_at, status)
       values ($1, 'INGAME', 'GAMEIN', 6, now() + interval '3 minutes', 'active')`,
      [hu],
    );
    await pg.query(
      `insert into daily_puzzles (puzzle_date, wordlist_id, target_length, target_word, scrambled_letters, possible_count)
       values ((now() at time zone 'Europe/Budapest')::date, $1, 6, 'DAILYW', 'WDAILY', 10)`,
      [hu],
    );
  }, 60_000);

  const list = ["THOMAS", "AVENUE", "INGAME", "DAILYW", "SUGGES", "ALREADY", "MISSING"];

  it("dry run: only active original rows, in-play targets flagged", async () => {
    const rows = (await pg.query<{ word: string; in_play: boolean }>(DRY_RUN_SQL, [hu, list])).rows;
    expect(Object.fromEntries(rows.map((r) => [r.word, r.in_play]))).toEqual({
      THOMAS: false,
      AVENUE: false,
      INGAME: true,
      DAILYW: true,
    });
  });

  it("inactivates the eligible words only, in this wordlist only", async () => {
    const done = (await pg.query<{ word: string }>(INACTIVATE_SQL, [hu, list])).rows.map((r) => r.word).sort();
    expect(done).toEqual(["AVENUE", "THOMAS"]);
    expect(await active(hu, "THOMAS")).toBe(false);
    expect(await active(en, "THOMAS")).toBe(true);
    expect(await active(hu, "INGAME")).toBe(true);
    expect(await active(hu, "DAILYW")).toBe(true);
    expect(await active(hu, "SUGGES")).toBe(true);
    // idempotent: a second run changes nothing
    expect((await pg.query(INACTIVATE_SQL, [hu, list])).rows).toEqual([]);
  });

  it("revert reactivates exactly the recorded words, not one inactive for another reason", async () => {
    const restored = (await pg.query<{ word: string }>(REACTIVATE_SQL, [hu, ["THOMAS", "AVENUE"]])).rows.map((r) => r.word).sort();
    expect(restored).toEqual(["AVENUE", "THOMAS"]);
    expect(await active(hu, "ALREADY")).toBe(false);
  });
});
