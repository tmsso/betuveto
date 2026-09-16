/**
 * Player-level preferences, separate from any single game: `players.preferred_length`
 * (ROADMAP 2.3), `players.preferred_language` (ROADMAP 6.2, migrations/0010) — the UI
 * language, independent of a game's wordlist — `players.preferred_theme` (ROADMAP Batch
 * 10 item 7, migrations/0016) and `players.sound_enabled` (item 8, migrations/0017).
 * Read/written via api/v1/me/preferences using the same anon-cookie identity as
 * game/start (lib/auth.ts).
 */
import { db } from "./db.js";
import type { Reply } from "./game.js";
import { MAX_TARGET_LENGTH, MIN_TARGET_LENGTH } from "./words.js";

const SUPPORTED_LANGUAGES = ["hu", "en"];
const SUPPORTED_THEMES = ["light", "dark", "system"];

// Shared with lib/admin-players.ts's renamePlayer (ROADMAP 7.2.0) so the trim/length rule
// only exists once.
export const DISPLAY_NAME_MAX_LENGTH = 20;

/** Trim + length-cap only — callers decide what an empty trimmed result means (the admin
 *  rename tool treats it as "clear the name"; setDisplayName below rejects it, since an
 *  empty PATCH on this player-facing preference shouldn't silently no-op). */
export function normalizeDisplayName(rawName: unknown): { trimmed: string } | { error: string } {
  if (typeof rawName !== "string") {
    return { error: "display_name must be a string." };
  }
  const trimmed = rawName.trim();
  if (trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
    return { error: `display_name must be at most ${DISPLAY_NAME_MAX_LENGTH} characters.` };
  }
  return { trimmed };
}

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

export async function getPreferredTheme(playerId: string | null): Promise<Reply> {
  if (!playerId) return { status: 200, body: { preferred_theme: null } };

  const sql = db();
  const [row] = await sql<{ preferred_theme: string | null }[]>`
    select preferred_theme from players where id = ${playerId}
  `;
  return { status: 200, body: { preferred_theme: row?.preferred_theme ?? null } };
}

export async function setPreferredTheme(
  playerId: string | null,
  rawTheme: unknown,
): Promise<Reply> {
  if (!playerId) {
    return { status: 401, body: { detail: "No player identity. Start a game first." } };
  }
  if (typeof rawTheme !== "string" || !SUPPORTED_THEMES.includes(rawTheme)) {
    return {
      status: 422,
      body: { detail: `preferred_theme must be one of: ${SUPPORTED_THEMES.join(", ")}.` },
    };
  }

  const sql = db();
  await sql`
    insert into players (id, preferred_theme)
    values (${playerId}, ${rawTheme})
    on conflict (id) do update set preferred_theme = excluded.preferred_theme
  `;
  return { status: 200, body: { preferred_theme: rawTheme } };
}

export async function getSoundEnabled(playerId: string | null): Promise<Reply> {
  if (!playerId) return { status: 200, body: { sound_enabled: null } };

  const sql = db();
  const [row] = await sql<{ sound_enabled: boolean | null }[]>`
    select sound_enabled from players where id = ${playerId}
  `;
  return { status: 200, body: { sound_enabled: row?.sound_enabled ?? null } };
}

export async function setSoundEnabled(
  playerId: string | null,
  rawValue: unknown,
): Promise<Reply> {
  if (!playerId) {
    return { status: 401, body: { detail: "No player identity. Start a game first." } };
  }
  if (typeof rawValue !== "boolean") {
    return { status: 422, body: { detail: "sound_enabled must be true or false." } };
  }

  const sql = db();
  await sql`
    insert into players (id, sound_enabled)
    values (${playerId}, ${rawValue})
    on conflict (id) do update set sound_enabled = excluded.sound_enabled
  `;
  return { status: 200, body: { sound_enabled: rawValue } };
}

export async function getDisplayName(playerId: string | null): Promise<Reply> {
  if (!playerId) return { status: 200, body: { display_name: null } };

  const sql = db();
  const [row] = await sql<{ display_name: string | null }[]>`
    select display_name from players where id = ${playerId}
  `;
  return { status: 200, body: { display_name: row?.display_name ?? null } };
}

export async function setDisplayName(
  playerId: string | null,
  rawName: unknown,
): Promise<Reply> {
  if (!playerId) {
    return { status: 401, body: { detail: "No player identity. Start a game first." } };
  }
  const result = normalizeDisplayName(rawName);
  if ("error" in result) return { status: 422, body: { detail: result.error } };
  if (result.trimmed.length === 0) {
    return { status: 422, body: { detail: "display_name must not be blank." } };
  }

  const sql = db();
  await sql`
    insert into players (id, display_name)
    values (${playerId}, ${result.trimmed})
    on conflict (id) do update set display_name = excluded.display_name
  `;
  return { status: 200, body: { display_name: result.trimmed } };
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
