/**
 * Player-level preferences, separate from any single game: `players.preferred_length`
 * (ROADMAP 2.3) and `players.preferred_language` (ROADMAP 6.2, migrations/0010) — the UI
 * language, independent of a game's wordlist. Read/written via api/v1/me/preferences
 * using the same anon-cookie identity as game/start (lib/auth.ts).
 */
import { db } from "./db.js";
import type { Reply } from "./game.js";
import { MAX_TARGET_LENGTH, MIN_TARGET_LENGTH } from "./words.js";

const SUPPORTED_LANGUAGES = ["hu", "en"];

/** No identity yet (never played, or a stale/missing cookie) reads as "no preference
 *  known" rather than an error — the frontend just falls back to its own defaults. */
export async function getPreferredLength(playerId: string | null): Promise<Reply> {
  if (!playerId) return { status: 200, body: { preferred_length: null } };

  const sql = db();
  const [row] = await sql<{ preferred_length: number | null }[]>`
    select preferred_length from players where id = ${playerId}
  `;
  return { status: 200, body: { preferred_length: row?.preferred_length ?? null } };
}

export async function getPreferredLanguage(playerId: string | null): Promise<Reply> {
  if (!playerId) return { status: 200, body: { preferred_language: null } };

  const sql = db();
  const [row] = await sql<{ preferred_language: string | null }[]>`
    select preferred_language from players where id = ${playerId}
  `;
  return { status: 200, body: { preferred_language: row?.preferred_language ?? null } };
}

export async function setPreferredLanguage(
  playerId: string | null,
  rawLanguage: unknown,
): Promise<Reply> {
  if (!playerId) {
    return { status: 401, body: { detail: "No player identity. Start a game first." } };
  }
  if (typeof rawLanguage !== "string" || !SUPPORTED_LANGUAGES.includes(rawLanguage)) {
    return {
      status: 422,
      body: { detail: `preferred_language must be one of: ${SUPPORTED_LANGUAGES.join(", ")}.` },
    };
  }

  const sql = db();
  await sql`
    insert into players (id, preferred_language)
    values (${playerId}, ${rawLanguage})
    on conflict (id) do update set preferred_language = excluded.preferred_language
  `;
  return { status: 200, body: { preferred_language: rawLanguage } };
}

export async function setPreferredLength(
  playerId: string | null,
  rawLength: unknown,
): Promise<Reply> {
  // Unlike the GET side, writing a preference with no identity is a no-op error, not a
  // silent default: there is nowhere to persist it, and the caller should know that.
  if (!playerId) {
    return { status: 401, body: { detail: "No player identity. Start a game first." } };
  }

  if (
    typeof rawLength !== "number" ||
    !Number.isInteger(rawLength) ||
    rawLength < MIN_TARGET_LENGTH ||
    rawLength > MAX_TARGET_LENGTH
  ) {
    return {
      status: 422,
      body: {
        detail: `preferred_length must be an integer between ${MIN_TARGET_LENGTH} and ${MAX_TARGET_LENGTH}.`,
      },
    };
  }

  const sql = db();
  // Upsert rather than assume the row exists: a valid cookie always implies a players row
  // in practice (game/start creates one when it mints the cookie), but this endpoint
  // shouldn't have to assume that invariant holds forever to stay correct.
  await sql`
    insert into players (id, preferred_length)
    values (${playerId}, ${rawLength})
    on conflict (id) do update set preferred_length = excluded.preferred_length
  `;
  return { status: 200, body: { preferred_length: rawLength } };
}
