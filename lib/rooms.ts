/**
 * Multiplayer rooms (ROADMAP 7.2). The lobby (create / join / leave, 7.2.2), the start of
 * a round (7.2.3), and the snapshot every member polls. Ending a room lives in
 * lib/room-lifecycle.ts; playing it is the ordinary single-player game code, one `games`
 * row per member with `room_id` set.
 *
 * Full design: docs/multiplayer.md.
 */
import type { Sql } from "postgres";
import { getConfig, getUiConfig } from "./config.js";
import { db, wordlistAlphabet, wordlistId } from "./db.js";
import { type Reply, effectiveScore, epochSeconds, findableWords } from "./game-core.js";
import { expireRoomIfDue } from "./room-lifecycle.js";
import { MAX_TARGET_LENGTH, MIN_TARGET_LENGTH, durationForLength, scrambleWord } from "./words.js";
import { normalizeDisplayName } from "./players.js";

// Excludes I/L/O/0/1 — easy to read aloud and to type on a phone without ambiguity.
const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 6;
const CODE_GENERATION_ATTEMPTS = 5;
// Decided without asking (docs/multiplayer.md §7, "reversible, within existing
// conventions"): room cap 8, min 2 to start (7.2.3), presence window 10s, idle-lobby
// cancellation lazily reported after 30 minutes (no sweeper — same pattern as game expiry).
const MAX_MEMBERS = 8;
const MIN_MEMBERS_TO_START = 2;
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
  // The board — null until started (7.2.3).
  target_word: string | null;
  scrambled_letters: string | null;
  possible_count: number | null;
  started_at: Date | null;
  ends_at: Date | null;
  end_reason: string | null;
  bonus_per_member: number | null;
}

interface RoomPlayerRow {
  player_id: string;
  display_name: string | null;
  last_seen_at: string;
  // The member's own game — all null in the lobby.
  game_id: string | null;
  game_status: string | null;
  game_ends_at: Date | null;
  game_ended_at: Date | null;
  scrambled_letters: string | null;
  found_count: number | null;
  final_score: number | null;
  raw_guess_score: number;
  hint_cost_total: number;
  hint_count: number;
  found_target: boolean;
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
           r.target_length, r.mode, r.status, r.next_room_code, r.created_at,
           r.target_word, r.scrambled_letters, r.possible_count, r.started_at, r.ends_at,
           r.end_reason, r.bonus_per_member
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
  // One row per member with their own game's live numbers, derived exactly the way
  // loadGame derives them (sums over game_guesses / game_hints) — no second copy of score
  // or found_count is stored anywhere (docs/multiplayer.md §3).
  return sql<RoomPlayerRow[]>`
    select rp.player_id, p.display_name, rp.last_seen_at,
           g.id as game_id, g.status as game_status, g.ends_at as game_ends_at,
           g.ended_at as game_ended_at, g.scrambled_letters, g.found_count, g.final_score,
           coalesce((select sum(score)::int from game_guesses
                      where game_id = g.id and correct), 0) as raw_guess_score,
           coalesce((select sum(cost)::int from game_hints where game_id = g.id), 0) as hint_cost_total,
           (select count(*)::int from game_hints where game_id = g.id) as hint_count,
           exists (select 1 from game_guesses
                    where game_id = g.id and correct and word = g.target_word) as found_target
      from room_players rp
      join players p on p.id = rp.player_id
      left join games g on g.id = rp.game_id
     where rp.room_id = ${roomId}
     order by rp.joined_at asc
  `;
}

/** A member's current score: the persisted final score once their game has ended,
 *  otherwise the live effective score (same floor-at-0 rule as a solo game). */
function memberScore(m: RoomPlayerRow): number {
  return m.final_score ?? effectiveScore(m.raw_guess_score, m.hint_cost_total);
}

/** "Done" = the member's own game is terminal (or past the shared deadline). */
function memberDone(m: RoomPlayerRow, now: number): boolean {
  if (!m.game_status) return false;
  if (m.game_status !== "active") return true;
  return m.game_ends_at !== null && now > m.game_ends_at.getTime();
}

/**
 * Word-agnostic live milestones (ROADMAP 7.2.4b, docs/multiplayer.md §1), derived at read
 * time from the member's own game — nothing stored, so nothing to keep in sync. Only the
 * highest clearance badge is listed (½ → ¾ → ✔), not all three at once.
 */
function memberBadges(m: RoomPlayerRow, possibleCount: number | null): string[] {
  if (!m.game_id) return [];
  const badges: string[] = [];
  if (m.found_target) badges.push("full_word");
  const fraction = possibleCount ? (m.found_count ?? 0) / possibleCount : 0;
  if (fraction >= 1) badges.push("all_cleared");
  else if (fraction >= 0.75) badges.push("three_quarters_cleared");
  else if (fraction >= 0.5) badges.push("half_cleared");
  if (m.hint_count > 0) badges.push("hint_used");
  if (m.game_status === "given_up") badges.push("gave_up");
  return badges;
}

/** Ranking (docs/multiplayer.md §1): score desc, then found_count desc, then the earlier
 *  finisher; members equal on all three share a rank (1, 1, 3 — standard competition
 *  ranking). Returns rank by player_id. */
function rankMembers(members: RoomPlayerRow[]): Map<string, number> {
  const endMs = (m: RoomPlayerRow) => m.game_ended_at?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const sorted = [...members].sort(
    (a, b) =>
      memberScore(b) - memberScore(a) ||
      (b.found_count ?? 0) - (a.found_count ?? 0) ||
      endMs(a) - endMs(b),
  );
  const ranks = new Map<string, number>();
  sorted.forEach((m, i) => {
    const prev = sorted[i - 1];
    const tied =
      prev &&
      memberScore(prev) === memberScore(m) &&
      (prev.found_count ?? 0) === (m.found_count ?? 0) &&
      endMs(prev) === endMs(m);
    ranks.set(m.player_id, tied ? ranks.get(prev.player_id)! : i + 1);
  });
  return ranks;
}

/** The snapshot — the single read every member polls (docs/multiplayer.md §4). */
async function buildSnapshot(sql: Sql, room: RoomRow, callerId: string): Promise<Record<string, unknown>> {
  const members = await loadMembers(sql, room.id);
  const now = Date.now();
  const snapshot: Record<string, unknown> = {
    code: room.code,
    status: room.status,
    mode: room.mode,
    wordlist: room.wordlist,
    target_length: room.target_length,
    is_host: room.host_player_id === callerId,
    member_count: members.length,
    max_members: MAX_MEMBERS,
    ends_at: room.ends_at ? epochSeconds(room.ends_at) : null,
    possible_count: room.possible_count,
    members: members.map((m) => ({
      player_id: m.player_id,
      display_name: m.display_name,
      is_you: m.player_id === callerId,
      is_host: m.player_id === room.host_player_id,
      online: now - new Date(m.last_seen_at).getTime() <= ONLINE_WINDOW_SECONDS * 1000,
      found_count: m.found_count ?? 0,
      score: m.game_id ? memberScore(m) : 0,
      done: memberDone(m, now),
      badges: memberBadges(m, room.possible_count),
    })),
    next_room_code: room.next_room_code,
  };

  // Words found by *anyone*, as one count — co-op only: in versus it would tell you how
  // much of the board your opponents hold (docs/multiplayer.md §6).
  if (room.mode === "coop" && room.status !== "lobby") {
    const [{ found }] = await sql<{ found: number }[]>`
      select count(distinct gg.word)::int as found
        from game_guesses gg join games g on g.id = gg.game_id
       where g.room_id = ${room.id} and gg.correct
    `;
    snapshot.room_found_count = found;
  }

  // The reveal — finished rooms only (D5: nothing stays hidden after the game; D9: nothing
  // is revealed before it).
  if (room.status === "finished" && room.target_word) {
    const config = await getConfig();
    const guessRows = await sql<{ player_id: string; word: string }[]>`
      select g.player_id, gg.word
        from game_guesses gg join games g on g.id = gg.game_id
       where g.room_id = ${room.id} and gg.correct
       order by gg.created_at
    `;
    const wordsBy = new Map<string, string[]>();
    for (const row of guessRows) wordsBy.set(row.player_id, [...(wordsBy.get(row.player_id) ?? []), row.word]);
    const everyoneFound = new Set(guessRows.map((row) => row.word));
    const possible = await findableWords(sql, room.wordlist_id, room.target_word, config.min_word_length);
    const ranks = rankMembers(members);
    snapshot.reveal = {
      target_word: room.target_word,
      remaining_words: possible.filter((word) => !everyoneFound.has(word)),
      members: members
        .map((m) => ({
          player_id: m.player_id,
          display_name: m.display_name,
          words: wordsBy.get(m.player_id) ?? [],
          final_score: memberScore(m),
          found_count: m.found_count ?? 0,
          rank: ranks.get(m.player_id)!,
          badges: memberBadges(m, room.possible_count),
        }))
        .sort((a, b) => a.rank - b.rank),
      end_reason: room.end_reason,
      room_cleared: room.end_reason === "cleared",
      bonus_per_member: room.bonus_per_member ?? 0,
    };
  }

  // your_game: the caller's own game, shaped exactly like a game/start response so the
  // frontend applies it with the same useGame.beginFromStartResponse (7.2.6). The board
  // comes from the member's own games row, not the room's, so a personal rescramble
  // survives the next poll.
  const you = members.find((m) => m.player_id === callerId);
  if (you?.game_id && room.ends_at && room.started_at) {
    const [config, ui, alphabet] = await Promise.all([
      getConfig(),
      getUiConfig(),
      wordlistAlphabet(room.wordlist),
    ]);
    snapshot.your_game = {
      game_id: you.game_id,
      wordlist: room.wordlist,
      alphabet,
      scrambled_letters: you.scrambled_letters,
      target_length: room.target_length,
      game_active: !memberDone(you, now),
      ends_at: epochSeconds(room.ends_at),
      duration_seconds: Math.round((room.ends_at.getTime() - room.started_at.getTime()) / 1000),
      possible_count: room.possible_count,
      difficulty: "normal",
      ui: {
        show_length_selector: ui.show_length_selector,
        show_wordlist_selector: ui.show_wordlist_selector,
        show_easy_mode: ui.show_easy_mode,
      },
      rules: { hint_cost: config.hint_cost, min_word_length: config.min_word_length },
    };
  }
  return snapshot;
}

/** A new lobby room with a fresh unique code, host already joined — shared by createRoom
 *  and rematchRoom. Null if no unique code turned up in CODE_GENERATION_ATTEMPTS tries. */
async function insertLobbyRoom(
  sql: Sql,
  hostId: string,
  listId: number,
  targetLength: number,
  mode: string,
): Promise<{ id: string; code: string } | null> {
  for (let attempt = 0; attempt < CODE_GENERATION_ATTEMPTS; attempt++) {
    const candidate = generateCode();
    try {
      const [inserted] = await sql<{ id: string }[]>`
        insert into rooms (code, host_player_id, wordlist_id, target_length, mode)
        values (${candidate}, ${hostId}, ${listId}, ${targetLength}, ${mode})
        returning id
      `;
      await sql`insert into room_players (room_id, player_id) values (${inserted.id}, ${hostId})`;
      return { id: inserted.id, code: candidate };
    } catch (error) {
      if ((error as { code?: string }).code === "23505") continue; // unique_violation: retry
      throw error;
    }
  }
  return null;
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

  const created = await insertLobbyRoom(sql, playerId, listId, targetLength, mode);
  if (!created) {
    return { status: 503, body: { detail: "Could not generate a unique room code, try again." } };
  }
  const { code } = created;

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

  // Lobby only. Once a round is playing, "leaving" is giving up your own game (the normal
  // give_up route) — there's no separate half-state for it.
  if (room.status === "playing") return { status: 409, body: { detail: "room_started" } };
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

  // Lazy expiry (7.2.3): the first read after the shared deadline finishes the room and
  // every member game, then re-reads so this response already shows the finished state.
  if (await expireRoomIfDue(sql, room, await getConfig())) {
    const refreshed = await loadRoomForCode(sql, room.code);
    if (refreshed) return { status: 200, body: await buildSnapshot(sql, refreshed, playerId) };
  }

  return { status: 200, body: await buildSnapshot(sql, room, playerId) };
}

/**
 * POST /rooms/{code}/start — host only, lobby only, at least MIN_MEMBERS_TO_START members
 * (ROADMAP 7.2.3). Picks one board for everyone and creates one ordinary `games` row per
 * member, all sharing the room's deadline.
 *
 * The target is a uniform random pick, never pickPersonalizedWord: one board has to suit
 * everyone, the same rule as the daily puzzle. `durationSeconds` is the same test-only
 * override game/start has (clamped, can only shorten the clock).
 */
export async function startRoom(
  code: string,
  playerId: string | null,
  durationSeconds: number | undefined,
): Promise<Reply> {
  if (!playerId) return { status: 401, body: { detail: "No player identity. Start a game first." } };
  if (durationSeconds !== undefined && !Number.isInteger(durationSeconds)) {
    return { status: 422, body: { detail: "duration_seconds must be an integer." } };
  }

  const sql = db();
  const room = await loadRoomForCode(sql, code);
  if (!room) return { status: 404, body: { detail: "Unknown room." } };
  if (room.host_player_id !== playerId) return { status: 403, body: { detail: "not_host" } };
  if (room.status === "playing" || room.status === "finished") {
    return { status: 409, body: { detail: "room_started" } };
  }
  if (room.status !== "lobby") return { status: 409, body: { detail: "room_cancelled" } };

  const [{ count }] = await sql<{ count: number }[]>`
    select count(*)::int as count from room_players where room_id = ${room.id}
  `;
  if (count < MIN_MEMBERS_TO_START) return { status: 409, body: { detail: "not_enough_players" } };

  const config = await getConfig();
  const [pick] = await sql<{ word: string }[]>`
    select word from words
     where wordlist_id = ${room.wordlist_id} and length = ${room.target_length} and active
     order by random()
     limit 1
  `;
  if (!pick) return { status: 404, body: { detail: `No words found with length ${room.target_length}` } };
  const possible = await findableWords(sql, room.wordlist_id, pick.word, config.min_word_length);
  const scrambled = scrambleWord(pick.word);

  const maxDuration = durationForLength(
    room.target_length,
    config.timer_base_seconds,
    config.timer_seconds_per_extra_length,
  );
  const duration =
    durationSeconds === undefined ? maxDuration : Math.min(Math.max(durationSeconds, 5), maxDuration);

  // One transaction: flip the room (race-safe — a double-clicked Start matches the
  // `status = 'lobby'` guard only once), create every member's game with the room's
  // shared deadline, and point each membership at its game.
  const started = await sql.begin(async (tx) => {
    const [flipped] = await tx<{ ends_at: Date }[]>`
      update rooms
         set status = 'playing', target_word = ${pick.word}, scrambled_letters = ${scrambled},
             possible_count = ${possible.length}, started_at = now(),
             ends_at = now() + ${`${duration} seconds`}::interval
       where id = ${room.id} and status = 'lobby'
       returning ends_at
    `;
    if (!flipped) return false;
    const games = await tx<{ id: string; player_id: string }[]>`
      insert into games (player_id, wordlist_id, target_word, target_length, scrambled_letters,
                         possible_count, ends_at, room_id)
      select rp.player_id, ${room.wordlist_id}, ${pick.word}, ${room.target_length}, ${scrambled},
             ${possible.length}, ${flipped.ends_at}, ${room.id}
        from room_players rp
       where rp.room_id = ${room.id}
      returning id, player_id
    `;
    for (const game of games) {
      await tx`
        update room_players set game_id = ${game.id}
         where room_id = ${room.id} and player_id = ${game.player_id}
      `;
    }
    return true;
  });
  if (!started) return { status: 409, body: { detail: "room_started" } };

  const refreshed = await loadRoomForCode(sql, room.code);
  if (!refreshed) throw new Error("Room vanished immediately after start.");
  return { status: 200, body: await buildSnapshot(sql, refreshed, playerId) };
}

/**
 * POST /rooms/{code}/rematch — host only, finished rooms only (ROADMAP 7.2.6's backend).
 * A new lobby with the same settings and mode, the host already in it; the old room's
 * `next_room_code` points at it, so every other member sees "join the rematch" on their
 * next poll and joins with one tap. Idempotent: asking again returns the same new room.
 */
export async function rematchRoom(code: string, playerId: string | null): Promise<Reply> {
  if (!playerId) return { status: 401, body: { detail: "No player identity. Start a game first." } };
  const sql = db();
  const room = await loadRoomForCode(sql, code);
  if (!room) return { status: 404, body: { detail: "Unknown room." } };
  if (room.host_player_id !== playerId) return { status: 403, body: { detail: "not_host" } };
  if (room.status !== "finished") return { status: 409, body: { detail: "room_not_finished" } };
  if (room.next_room_code) return { status: 200, body: { code: room.next_room_code } };

  const created = await insertLobbyRoom(sql, playerId, room.wordlist_id, room.target_length, room.mode);
  if (!created) return { status: 503, body: { detail: "Could not generate a unique room code, try again." } };
  // Guarded so two concurrent rematch clicks can't leave the old room pointing at a
  // different lobby than the one returned: the loser cancels its own spare room and
  // returns the winner's.
  const [linked] = await sql<{ next_room_code: string }[]>`
    update rooms set next_room_code = ${created.code}
     where id = ${room.id} and next_room_code is null
     returning next_room_code
  `;
  if (!linked) {
    await sql`update rooms set status = 'cancelled' where id = ${created.id}`;
    const [winner] = await sql<{ next_room_code: string }[]>`select next_room_code from rooms where id = ${room.id}`;
    return { status: 200, body: { code: winner.next_room_code } };
  }
  return { status: 200, body: { code: created.code } };
}
