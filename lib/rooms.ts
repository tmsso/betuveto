/**
 * Multiplayer rooms — the lobby (ROADMAP 7.2.2). Create / join / leave / snapshot, all
 * that migration 0020 needs. Starting a room, playing it, and finishing it are later work
 * orders (7.2.3-7.2.4b) — every status this file can actually produce is 'lobby' or
 * 'cancelled'; 'playing'/'finished' exist in the schema (and are handled defensively
 * below) only because the snapshot shape and the join/leave status checks are the same
 * code that later items build on, not because this file can reach them yet.
 *
 * Full design: docs/multiplayer.md.
 */
import type { Sql } from "postgres";
import type { Reply } from "./game.js";
import { db, wordlistId } from "./db.js";
import { getUiConfig } from "./config.js";
import { MAX_TARGET_LENGTH, MIN_TARGET_LENGTH } from "./words.js";
import { normalizeDisplayName } from "./players.js";

// Excludes I/L/O/0/1 — easy to read aloud and to type on a phone without ambiguity.
const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 6;
const CODE_GENERATION_ATTEMPTS = 5;
// Decided without asking (docs/multiplayer.md §7, "reversible, within existing
// conventions"): room cap 8, min 2 to start (7.2.3), presence window 10s, idle-lobby
// cancellation lazily reported after 30 minutes (no sweeper — same pattern as game expiry).
const MAX_MEMBERS = 8;
const ONLINE_WINDOW_SECONDS = 10;
const IDLE_LOBBY_CANCEL_MINUTES = 30;

interface RoomRow {
  id: string;
  code: string;
  host_player_id: string | null;
  wordlist_id: number;
  wordlist: string;
  target_length: number;
  mode: string;
  status: string;
  next_room_code: string | null;
  created_at: string;
}

interface RoomPlayerRow {
  player_id: string;
  display_name: string | null;
  last_seen_at: string;
}

function generateCode(): string {
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

/** Loads a room by code, lazily cancelling an idle lobby the same way game expiry is lazy
 *  (docs/multiplayer.md §7) — no sweeper process, just a check on the next read. */
async function loadRoomForCode(sql: Sql, rawCode: string): Promise<RoomRow | null> {
  const code = rawCode.trim().toUpperCase();
  const [room] = await sql<RoomRow[]>`
    select r.id, r.code, r.host_player_id, r.wordlist_id, wl.code as wordlist,
           r.target_length, r.mode, r.status, r.next_room_code, r.created_at
      from rooms r
      join wordlists wl on wl.id = r.wordlist_id
     where r.code = ${code}
  `;
  if (!room) return null;

  const idleCutoffMs = IDLE_LOBBY_CANCEL_MINUTES * 60 * 1000;
  if (room.status === "lobby" && Date.now() - new Date(room.created_at).getTime() > idleCutoffMs) {
    const [cancelled] = await sql<{ status: string }[]>`
      update rooms set status = 'cancelled' where id = ${room.id} and status = 'lobby'
      returning status
    `;
    if (cancelled) room.status = cancelled.status;
  }
  return room;
}

async function loadMembers(sql: Sql, roomId: string): Promise<RoomPlayerRow[]> {
  return sql<RoomPlayerRow[]>`
    select rp.player_id, p.display_name, rp.last_seen_at
      from room_players rp
      join players p on p.id = rp.player_id
     where rp.room_id = ${roomId}
     order by rp.joined_at asc
  `;
}

/** The lobby-shape snapshot (ROADMAP 7.2.2's own scope) — the gameplay fields the full
 *  contract eventually has (your_game, reveal, per-member found_count/score/badges) don't
 *  exist yet; they arrive with the work orders that make them meaningful (7.2.3-7.2.4b). */
async function buildSnapshot(sql: Sql, room: RoomRow, callerId: string): Promise<Record<string, unknown>> {
  const members = await loadMembers(sql, room.id);
  const now = Date.now();
  return {
    code: room.code,
    status: room.status,
    mode: room.mode,
    wordlist: room.wordlist,
    target_length: room.target_length,
    is_host: room.host_player_id === callerId,
    member_count: members.length,
    max_members: MAX_MEMBERS,
    ends_at: null,
    possible_count: null,
    members: members.map((m) => ({
      player_id: m.player_id,
      display_name: m.display_name,
      is_you: m.player_id === callerId,
      is_host: m.player_id === room.host_player_id,
      online: now - new Date(m.last_seen_at).getTime() <= ONLINE_WINDOW_SECONDS * 1000,
    })),
    next_room_code: room.next_room_code,
  };
}

export async function createRoom(
  rawDisplayName: unknown,
  rawMode: unknown,
  rawWordlistCode: string | undefined,
  rawTargetLength: number,
  playerId: string,
  setCookieHeader: string | undefined,
): Promise<Reply> {
  const nameResult = normalizeDisplayName(rawDisplayName);
  if ("error" in nameResult) return { status: 422, body: { detail: nameResult.error } };
  if (nameResult.trimmed.length === 0) {
    return { status: 422, body: { detail: "display_name must not be blank." } };
  }

  const mode = rawMode === undefined ? "coop" : rawMode;
  if (mode !== "coop" && mode !== "versus") {
    return { status: 422, body: { detail: "mode must be 'coop' or 'versus'." } };
  }

  // ROADMAP Batch 10 item 14 hidden-selector forcing, same pattern as lib/daily.ts's
  // resolveDailyAxes and lib/game.ts's startGame — a hidden control is a fixed axis for
  // everyone, not just a removed widget. Rooms have no easy-mode axis, so only these two.
  const ui = await getUiConfig();
  let wordlistCode = rawWordlistCode;
  let targetLength = rawTargetLength;
  if (!ui.show_length_selector) targetLength = ui.default_length;
  if (!ui.show_wordlist_selector) wordlistCode = ui.default_wordlist;

  if (
    !Number.isInteger(targetLength) ||
    targetLength < MIN_TARGET_LENGTH ||
    targetLength > MAX_TARGET_LENGTH
  ) {
    return {
      status: 422,
      body: { detail: `target_length must be an integer between ${MIN_TARGET_LENGTH} and ${MAX_TARGET_LENGTH}.` },
    };
  }

  const sql = db();
  const listId = await wordlistId(wordlistCode);

  // The caller always sets their display_name here (required to create a room), whether
  // or not this is their first-ever request — a single upsert covers both, unlike
  // game/start's identity-only insert (which never touches display_name).
  await sql`
    insert into players (id, display_name)
    values (${playerId}, ${nameResult.trimmed})
    on conflict (id) do update set display_name = excluded.display_name
  `;

  let code: string | null = null;
  let roomId: string | null = null;
  for (let attempt = 0; attempt < CODE_GENERATION_ATTEMPTS && !roomId; attempt++) {
    const candidate = generateCode();
    try {
      const [inserted] = await sql<{ id: string }[]>`
        insert into rooms (code, host_player_id, wordlist_id, target_length, mode)
        values (${candidate}, ${playerId}, ${listId}, ${targetLength}, ${mode})
        returning id
      `;
      code = candidate;
      roomId = inserted.id;
    } catch (error) {
      if ((error as { code?: string }).code === "23505") continue; // unique_violation: retry
      throw error;
    }
  }
  if (!roomId || !code) {
    return { status: 503, body: { detail: "Could not generate a unique room code, try again." } };
  }

  await sql`insert into room_players (room_id, player_id) values (${roomId}, ${playerId})`;

  const room = await loadRoomForCode(sql, code);
  if (!room) throw new Error("Room vanished immediately after insert.");
  const snapshot = await buildSnapshot(sql, room, playerId);

  return {
    status: 200,
    body: { code: room.code, room: snapshot },
    ...(setCookieHeader ? { headers: { "Set-Cookie": setCookieHeader } } : {}),
  };
}

export async function joinRoom(
  code: string,
  rawDisplayName: unknown,
  playerId: string,
  setCookieHeader: string | undefined,
): Promise<Reply> {
  const nameResult = normalizeDisplayName(rawDisplayName);
  if ("error" in nameResult) return { status: 422, body: { detail: nameResult.error } };
  if (nameResult.trimmed.length === 0) {
    return { status: 422, body: { detail: "display_name must not be blank." } };
  }

  const sql = db();
  const room = await loadRoomForCode(sql, code);
  if (!room) return { status: 404, body: { detail: "Unknown room." } };

  const [existingMember] = await sql<{ player_id: string }[]>`
    select player_id from room_players where room_id = ${room.id} and player_id = ${playerId}
  `;

  if (!existingMember) {
    if (room.status === "playing") return { status: 409, body: { detail: "room_started" } };
    if (room.status === "finished" || room.status === "cancelled") {
      return { status: 409, body: { detail: "room_cancelled" } };
    }
    const [{ count }] = await sql<{ count: string }[]>`
      select count(*)::text as count from room_players where room_id = ${room.id}
    `;
    if (Number(count) >= MAX_MEMBERS) return { status: 409, body: { detail: "room_full" } };
  }

  // Sets/updates display_name and (re)joins — idempotent for an existing member, per the
  // roadmap's own acceptance text; joining again just refreshes the name and presence.
  await sql`
    insert into players (id, display_name)
    values (${playerId}, ${nameResult.trimmed})
    on conflict (id) do update set display_name = excluded.display_name
  `;
  await sql`
    insert into room_players (room_id, player_id)
    values (${room.id}, ${playerId})
    on conflict (room_id, player_id) do update set last_seen_at = now()
  `;

  const snapshot = await buildSnapshot(sql, room, playerId);
  return {
    status: 200,
    body: { room: snapshot },
    ...(setCookieHeader ? { headers: { "Set-Cookie": setCookieHeader } } : {}),
  };
}

export async function leaveRoom(code: string, playerId: string | null): Promise<Reply> {
  if (!playerId) return { status: 401, body: { detail: "No player identity. Start a game first." } };

  const sql = db();
  const room = await loadRoomForCode(sql, code);
  if (!room) return { status: 404, body: { detail: "Unknown room." } };

  // Lobby only (ROADMAP 7.2.2's own scope) — there's no route yet that lets a room leave
  // 'lobby', so this is the only status leaveRoom ever really sees in production, but the
  // guard is here defensively for when 7.2.3+ ships 'playing'.
  if (room.status === "lobby") {
    if (room.host_player_id === playerId) {
      // D4: the host leaving cancels the room (v1: no hand-off).
      await sql`update rooms set status = 'cancelled' where id = ${room.id} and status = 'lobby'`;
    } else {
      await sql`delete from room_players where room_id = ${room.id} and player_id = ${playerId}`;
    }
  }

  return { status: 200, body: { ok: true } };
}

export async function getRoomSnapshot(code: string, playerId: string | null): Promise<Reply> {
  if (!playerId) return { status: 401, body: { detail: "No player identity. Start a game first." } };

  const sql = db();
  const room = await loadRoomForCode(sql, code);
  if (!room) return { status: 404, body: { detail: "Unknown room." } };

  const [membership] = await sql<{ player_id: string }[]>`
    select player_id from room_players where room_id = ${room.id} and player_id = ${playerId}
  `;
  if (!membership) return { status: 404, body: { detail: "Unknown room." } };

  await sql`
    update room_players set last_seen_at = now() where room_id = ${room.id} and player_id = ${playerId}
  `;

  return { status: 200, body: await buildSnapshot(sql, room, playerId) };
}
