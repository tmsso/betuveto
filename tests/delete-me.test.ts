/**
 * "Delete my data" (DELETE /api/v1/me) against a real Postgres, in-process (PGlite — see
 * merge-players.test.ts). Runs the exact SQL text lib/account.ts sends.
 *
 * The `neon_auth` tables are a minimal stand-in for what Neon Auth creates in the same
 * database (checked on production 2026-11-11: `user.id` is a uuid, and `session` /
 * `account` reference it with ON DELETE CASCADE). Only the columns the deletion touches.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { deletePlayerSql } from "../lib/account.js";

const migrationsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations");
let pg: PGlite;

type Result = { deleted: number; sign_ins_deleted: number; admin: boolean };

async function one<T>(query: string, params: unknown[] = []): Promise<T> {
  return (await pg.query<T>(query, params)).rows[0] as T;
}

async function newPlayer(opts: { authUserId?: string; admin?: boolean } = {}): Promise<string> {
  return (await one<{ id: string }>(
    "insert into players (auth_user_id, is_admin) values ($1, $2) returning id",
    [opts.authUserId ?? null, opts.admin ?? false],
  )).id;
}

async function newSignIn(): Promise<string> {
  const id = (await one<{ id: string }>(
    `insert into neon_auth."user" (email) values ('player@example.com') returning id::text as id`,
  )).id;
  await pg.query(`insert into neon_auth.session ("userId") values ($1)`, [id]);
  await pg.query(`insert into neon_auth.account ("userId", "providerId") values ($1, 'google')`, [id]);
  return id;
}

async function count(query: string, params: unknown[]): Promise<number> {
  return (await one<{ n: number }>(`select count(*)::int as n from ${query}`, params)).n;
}

beforeAll(async () => {
  pg = new PGlite();
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort()) {
    await pg.exec(readFileSync(path.join(migrationsDir, file), "utf8"));
  }
}, 60_000);

describe("delete my data", () => {
  // Runs first, while the database has no neon_auth schema yet.
  it("still deletes the player on a database without Neon Auth", async () => {
    const id = await newPlayer();
    const r = await one<Result>(deletePlayerSql(false), [id]);
    expect(r).toEqual({ deleted: 1, sign_ins_deleted: 0, admin: false });
    expect(await count("players where id = $1", [id])).toBe(0);
  });

  it("deletes the linked Google sign-in with the player", async () => {
    await pg.exec(`
      create schema neon_auth;
      create table neon_auth."user" (id uuid primary key default gen_random_uuid(), email text);
      create table neon_auth.session (id serial primary key,
        "userId" uuid not null references neon_auth."user"(id) on delete cascade);
      create table neon_auth.account (id serial primary key, "providerId" text,
        "userId" uuid not null references neon_auth."user"(id) on delete cascade);
    `);
    const authId = await newSignIn();
    const otherAuthId = await newSignIn();
    const id = await newPlayer({ authUserId: authId });

    const r = await one<Result>(deletePlayerSql(true), [id]);

    expect(r).toEqual({ deleted: 1, sign_ins_deleted: 1, admin: false });
    expect(await count("players where id = $1", [id])).toBe(0);
    expect(await count(`neon_auth."user" where id::text = $1`, [authId])).toBe(0);
    expect(await count(`neon_auth.session where "userId"::text = $1`, [authId])).toBe(0);
    expect(await count(`neon_auth.account where "userId"::text = $1`, [authId])).toBe(0);
    // Someone else's sign-in is untouched.
    expect(await count(`neon_auth."user" where id::text = $1`, [otherAuthId])).toBe(1);
  });

  it("deletes an anonymous player without touching any sign-in", async () => {
    const before = await count(`neon_auth."user"`, []);
    const id = await newPlayer();
    const r = await one<Result>(deletePlayerSql(true), [id]);
    expect(r).toEqual({ deleted: 1, sign_ins_deleted: 0, admin: false });
    expect(await count(`neon_auth."user"`, [])).toBe(before);
  });

  it("refuses an admin and leaves both the player and the sign-in in place", async () => {
    const authId = await newSignIn();
    const id = await newPlayer({ authUserId: authId, admin: true });
    const r = await one<Result>(deletePlayerSql(true), [id]);
    expect(r).toEqual({ deleted: 0, sign_ins_deleted: 0, admin: true });
    expect(await count("players where id = $1", [id])).toBe(1);
    expect(await count(`neon_auth."user" where id::text = $1`, [authId])).toBe(1);
  });

  it("reports nothing deleted for an unknown player", async () => {
    const r = await one<Result>(deletePlayerSql(true), ["00000000-0000-0000-0000-000000000000"]);
    expect(r).toEqual({ deleted: 0, sign_ins_deleted: 0, admin: false });
  });
});
