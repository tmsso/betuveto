/**
 * Admin word writes (lib/admin-words.ts: edit, delete, bulk) on a real Postgres in-process
 * (PGlite). ROADMAP 16.8 (a) / D-2: these paths used to be exercised only by contract cases
 * that needed the shared ADMIN_TOKEN; with that login retired, they are covered here.
 *
 * `db()` is replaced by a minimal tagged-template adapter over PGlite (lib/admin-words.ts only
 * uses plain `sql\`...\`` queries), and the audit-log writers are stubbed so the test can read
 * what would be logged.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const pg = new PGlite();
const audit: { action: string; payload: Record<string, unknown> }[] = [];

/** `sql\`select ... ${x}\`` → pg.query("select ... $1", [x]). Throws Postgres errors with
 *  their `code` (e.g. 23505), as postgres.js does. */
function sqlAdapter() {
  return async (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ""), "");
    return (await pg.query(text, values)).rows;
  };
}

vi.mock("../lib/db.js", () => ({ db: () => sqlAdapter() }));
vi.mock("../lib/admin.js", () => ({
  logAdminAction: async (_admin: unknown, action: string, payload: Record<string, unknown>) => {
    audit.push({ action, payload });
  },
  logAdminActions: async (_admin: unknown, entries: { action: string; payload: Record<string, unknown> }[]) => {
    audit.push(...entries);
  },
}));

const { bulkWordAction, deleteWord, editWord } = await import("../lib/admin-words.js");

const ADMIN = { adminId: "11111111-1111-4111-8111-111111111111" };
let hu: number;

async function addWord(word: string, opts: { active?: boolean } = {}): Promise<number> {
  const r = await pg.query<{ id: string }>(
    "insert into words (wordlist_id, word, length, signature, active) values ($1, $2, $3, $2, $4) returning id",
    [hu, word, Array.from(word).length, opts.active ?? true],
  );
  return Number(r.rows[0].id);
}

async function wordRow(id: number) {
  return (await pg.query<{ word: string; length: number; signature: string; active: boolean }>(
    "select word, length, signature, active from words where id = $1", [id],
  )).rows[0];
}

async function liveGame(target: string, endsIn = "3 minutes"): Promise<void> {
  await pg.query(
    `insert into games (wordlist_id, target_word, scrambled_letters, target_length, ends_at, status)
     values ($1, $2, $2, 6, now() + $3::interval, 'active')`,
    [hu, target, endsIn],
  );
}

beforeAll(async () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await pg.exec(readFileSync(path.join(dir, file), "utf8"));
  }
  hu = (await pg.query<{ id: number }>("select id from wordlists where code = 'hu'")).rows[0]?.id ??
    (await pg.query<{ id: number }>("insert into wordlists (code, name, alphabet) values ('hu', 'Magyar', 'ABC') returning id")).rows[0].id;
}, 60_000);

beforeEach(() => {
  audit.length = 0;
});

describe("editWord", () => {
  it("renames a word, recomputes length and signature, and logs it", async () => {
    const id = await addWord("ALMAA");
    const r = await editWord(ADMIN, id, " almafa ");
    expect(r).toEqual({ status: 200, body: { id, word: "ALMAFA" } });
    expect(await wordRow(id)).toMatchObject({ word: "ALMAFA", length: 6, signature: "AAAFLM" });
    expect(audit).toEqual([{ action: "edit_word", payload: { word_id: id, from: "ALMAA", to: "ALMAFA" } }]);
  });

  it("refuses a spelling that already exists (409), an unknown id (404) and bad input (422)", async () => {
    const a = await addWord("KÖRTE");
    await addWord("BARACK");
    expect((await editWord(ADMIN, a, "barack")).status).toBe(409);
    expect((await editWord(ADMIN, 999_999, "szilva")).status).toBe(404);
    expect((await editWord(ADMIN, a, "ab")).status).toBe(422);
    expect((await editWord(ADMIN, a, 42)).status).toBe(422);
    expect(audit).toEqual([]);
  });

  it("refuses to rename a running game's target", async () => {
    const id = await addWord("CITROM");
    await liveGame("CITROM");
    expect((await editWord(ADMIN, id, "citromok")).status).toBe(409);
    expect((await wordRow(id)).word).toBe("CITROM");
  });
});

describe("deleteWord", () => {
  it("deletes the row (cascading its reports) and logs it", async () => {
    const id = await addWord("TÖRÖLNI");
    const player = (await pg.query<{ id: string }>("insert into players default values returning id")).rows[0].id;
    await pg.query("insert into word_reports (word_id, player_id) values ($1, $2)", [id, player]);
    expect(await deleteWord(ADMIN, id)).toEqual({ status: 200, body: { id, deleted: true } });
    expect(await wordRow(id)).toBeUndefined();
    expect((await pg.query("select 1 from word_reports where word_id = $1", [id])).rows).toEqual([]);
    expect(audit).toEqual([{ action: "delete_word", payload: { word_id: id, word: "TÖRÖLNI" } }]);
  });

  it("refuses today's daily target", async () => {
    const id = await addWord("NAPIKA");
    await pg.query(
      `insert into daily_puzzles (puzzle_date, wordlist_id, target_length, target_word, scrambled_letters, possible_count)
       values ((now() at time zone 'Europe/Budapest')::date, $1, 6, 'NAPIKA', 'KANIPA', 5)`,
      [hu],
    );
    expect((await deleteWord(ADMIN, id)).status).toBe(409);
    expect(await wordRow(id)).toBeDefined();
  });
});

describe("bulkWordAction", () => {
  it("validates the action and ids", async () => {
    expect((await bulkWordAction(ADMIN, "nuke", [1])).status).toBe(422);
    expect((await bulkWordAction(ADMIN, "inactivate", [])).status).toBe(422);
    for (const ids of [["x1"], [-1], [1.5], [0]]) {
      expect((await bulkWordAction(ADMIN, "inactivate", ids)).status, JSON.stringify(ids)).toBe(422);
    }
  });

  it("inactivates and reactivates only rows whose state changes, accepting numeric-string ids", async () => {
    const a = await addWord("EGYIKE");
    const b = await addWord("MASIKA", { active: false });
    const off = await bulkWordAction(ADMIN, "inactivate", [String(a), b, 888_888]);
    expect(off.status).toBe(200);
    expect(off.body).toMatchObject({
      action: "inactivate",
      changed: [{ id: a, word: "EGYIKE" }],
      unchanged_count: 1,
      skipped: [{ id: 888_888, reason: "not_found" }],
    });
    expect((await wordRow(a)).active).toBe(false);
    expect(audit).toEqual([{ action: "inactivate_word", payload: { word_id: a, word: "EGYIKE", bulk: true } }]);

    audit.length = 0;
    const on = await bulkWordAction(ADMIN, "reactivate", [a, b]);
    expect((on.body as { changed: unknown[] }).changed).toHaveLength(2);
    expect(audit.map((e) => e.action)).toEqual(["reactivate_word", "reactivate_word"]);
  });

  it("deletes, skipping a running game's target", async () => {
    const keep = await addWord("FUTÓKA");
    const gone = await addWord("MEHETA");
    await liveGame("FUTÓKA");
    const r = await bulkWordAction(ADMIN, "delete", [keep, gone]);
    expect(r.body).toMatchObject({
      changed: [{ id: gone, word: "MEHETA" }],
      skipped: [{ id: keep, word: "FUTÓKA", reason: "active_target" }],
    });
    expect(await wordRow(keep)).toBeDefined();
    expect(await wordRow(gone)).toBeUndefined();
  });
});
