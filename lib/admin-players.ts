/**
 * Player and leaderboard maintenance (ROADMAP Batch 5.2 item 3): view players, rename a
 * display name, list finished games for review, and disqualify one from the leaderboard.
 * Merging duplicate players is deliberately out of scope here — it's the same operation
 * Batch 8's Google OAuth merge rule needs, and building it now would mean either
 * duplicating that logic or pre-empting a design that batch hasn't landed yet.
 */
import { logAdminAction } from "./admin.js";
import { db, wordlistId } from "./db.js";
import type { Reply } from "./game.js";

const SEARCH_LIMIT = 50;
// ROADMAP 2.1 named 20 chars for the player-facing "name yourself" input, but that input
// was deferred and never built — there's no existing enforced limit to match, so this is
// just a sane standalone cap for the admin rename tool.
const DISPLAY_NAME_MAX_LENGTH = 20;

interface PlayerRow {
  id: string;
  display_name: string | null;
  created_at: string;
  is_admin: boolean;
  games_played: number;
  best_score: number | null;
}

/** With a query, matches on display_name; without one, the most recently created players
 *  first — mirrors lib/admin-words.ts's searchWords, same rationale. */
export async function searchPlayers(query: string): Promise<Reply> {
  const sql = db();
  const trimmed = query.trim();

  const rows = trimmed
    ? await sql<PlayerRow[]>`
        select p.id, p.display_name, p.created_at, p.is_admin,
               count(g.id) filter (where g.status = 'finished')::int as games_played,
               max(g.final_score) filter (where g.status = 'finished' and g.disqualified_at is null) as best_score
          from players p
          left join games g on g.player_id = p.id
         where p.display_name ilike ${`%${trimmed}%`}
         group by p.id
         order by p.created_at desc
         limit ${SEARCH_LIMIT}
      `
    : await sql<PlayerRow[]>`
        select p.id, p.display_name, p.created_at, p.is_admin,
               count(g.id) filter (where g.status = 'finished')::int as games_played,
               max(g.final_score) filter (where g.status = 'finished' and g.disqualified_at is null) as best_score
          from players p
          left join games g on g.player_id = p.id
         group by p.id
         order by p.created_at desc
         limit ${SEARCH_LIMIT}
      `;

  return { status: 200, body: { players: rows } };
}

export async function renamePlayer(playerId: string, rawName: unknown): Promise<Reply> {
  if (typeof rawName !== "string") {
    return { status: 422, body: { detail: "display_name must be a string." } };
  }
  const trimmed = rawName.trim();
  if (trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
    return { status: 422, body: { detail: `display_name must be at most ${DISPLAY_NAME_MAX_LENGTH} characters.` } };
  }

  const sql = db();
  const [player] = await sql<{ id: string }[]>`
    update players set display_name = ${trimmed || null} where id = ${playerId}
    returning id
  `;
  if (!player) return { status: 404, body: { detail: "Unknown player." } };

  await logAdminAction("rename_player", { player_id: playerId, to: trimmed || "(cleared)" });
  return { status: 200, body: { id: playerId, display_name: trimmed || null } };
}

interface LeaderboardEntryRow {
  id: string;
  final_score: number;
  target_length: number;
  wordlist: string;
  ended_at: string;
  player_id: string | null;
  display_name: string | null;
  hinted: boolean;
}

/** Broader than lib/scores.ts's public top-10-per-length view: an admin browsing for
 *  suspicious entries wants to scan across lengths, not just the current podium. */
export async function listLeaderboardEntries(
  wordlistCode: string,
  targetLength: number | undefined,
): Promise<Reply> {
  const sql = db();
  const listId = await wordlistId(wordlistCode);

  const rows = await sql<LeaderboardEntryRow[]>`
    select g.id, g.final_score, g.target_length, g.ended_at, g.player_id, p.display_name,
           exists(select 1 from game_hints h where h.game_id = g.id) as hinted
      from games g
      left join players p on p.id = g.player_id
     where g.wordlist_id = ${listId}
       and g.status = 'finished'
       and g.disqualified_at is null
       and (${targetLength ?? null}::int is null or g.target_length = ${targetLength ?? null})
     order by g.final_score desc
     limit ${SEARCH_LIMIT}
  `;

  return { status: 200, body: { wordlist: wordlistCode, entries: rows } };
}

interface GameDetailRow {
  id: string;
  player_id: string | null;
  display_name: string | null;
  wordlist: string;
  target_word: string;
  target_length: number;
  started_at: string;
  ends_at: string;
  ended_at: string | null;
  final_score: number | null;
  found_count: number;
  possible_count: number;
  status: string;
  disqualified_at: string | null;
}

interface GameGuessRow {
  word: string;
  correct: boolean;
  score: number;
  created_at: string;
}

interface GameHintRow {
  word: string;
  position: number;
  letter: string;
  cost: number;
  created_at: string;
}

/** ROADMAP Batch 10 item 12 — one game's full guess-by-guess (and hint-by-hint) timeline,
 *  admin-only. This does not conflict with the standing player-facing rule against
 *  revealing per-word history (Batch 10 item 3) — that rule is about what a *player* sees
 *  about their own past games, not admin visibility into any one game's record. Reveals
 *  target_word deliberately: an admin reviewing a game for correctness/abuse needs to see
 *  the answer, unlike a player who is mid-game or reading their own stats. */
export async function getGameDetail(gameId: string): Promise<Reply> {
  const sql = db();

  const [game] = await sql<GameDetailRow[]>`
    select g.id, g.player_id, p.display_name, wl.code as wordlist, g.target_word,
           g.target_length, g.started_at, g.ends_at, g.ended_at, g.final_score,
           g.found_count, g.possible_count, g.status, g.disqualified_at
      from games g
      join wordlists wl on wl.id = g.wordlist_id
      left join players p on p.id = g.player_id
     where g.id = ${gameId}
  `;
  if (!game) return { status: 404, body: { detail: "Unknown game." } };

  const guesses = await sql<GameGuessRow[]>`
    select word, correct, score, created_at
      from game_guesses
     where game_id = ${gameId}
     order by created_at
  `;
  const hints = await sql<GameHintRow[]>`
    select word, position, letter, cost, created_at
      from game_hints
     where game_id = ${gameId}
     order by created_at
  `;

  return { status: 200, body: { game, guesses, hints } };
}

export async function disqualifyGame(gameId: string): Promise<Reply> {
  const sql = db();
  const [game] = await sql<{ id: string; status: string; disqualified_at: string | null }[]>`
    select id, status, disqualified_at from games where id = ${gameId}
  `;
  if (!game) return { status: 404, body: { detail: "Unknown game." } };
  if (game.status !== "finished") {
    return { status: 409, body: { detail: `Game is ${game.status}, not finished — nothing to disqualify.` } };
  }
  if (game.disqualified_at) {
    return { status: 409, body: { detail: "Already disqualified." } };
  }

  await sql`update games set disqualified_at = now() where id = ${gameId}`;
  await logAdminAction("disqualify_game", { game_id: gameId });
  return { status: 200, body: { id: gameId, disqualified: true } };
}
