/**
 * The game primitives shared by single-player games (lib/game.ts) and multiplayer rooms
 * (lib/rooms.ts, lib/room-lifecycle.ts) — split out of lib/game.ts in ROADMAP 7.2.3,
 * unchanged. Why a separate module: game.ts's guess()/giveUp() now call room hooks, and
 * the room code needs finalizeExpiry/finalizeWordStats; with both living in game.ts that
 * would be an import cycle (game -> room-lifecycle -> game). Everything here depends only
 * downward (config, db, words, word-stats, achievements), so both sides import it freely.
 * lib/game.ts re-exports the public names, so existing importers are unaffected.
 */
import type { Sql } from "postgres";
import type { GameConfig } from "./config.js";
import {
  letterClearFraction,
  signatureOf,
  subSignatures,
} from "./words.js";
import { applyGameMastery, recordFailed } from "./word-stats.js";
import { evaluateAchievements } from "./achievements.js";

export interface Reply {
  status: number;
  body: unknown;
  /** Set-Cookie etc. — currently only game/start's freshly-minted anon identity uses this. */
  headers?: Record<string, string>;
}

export interface GameRow {
  id: string;
  wordlist_id: number;
  player_id: string | null;
  target_word: string;
  target_length: number;
  scrambled_letters: string;
  possible_count: number;
  found_count: number;
  status: string;
  ends_at: Date;
  // Non-null on a daily-puzzle game (ROADMAP Batch 10 item 1) — finalizeWordStats then
  // also grades a daily_results row at the terminal transition.
  daily_puzzle_id: number | null;
  // Non-null for a multiplayer room member's game (ROADMAP 7.2.3) — guess()/giveUp() then
  // run the room hooks in lib/room-lifecycle.ts.
  room_id: string | null;
  // Raw components, not a precomputed total: see effectiveScore's doc comment for why
  // flooring has to happen at the point of use rather than once here.
  raw_guess_score: number;
  hint_cost_total: number;
}

export const NOT_FOUND: Reply = {
  status: 404,
  body: { detail: "Game not found or expired. Start a new game." },
};

/** Seconds since the epoch, as the frontend's countdown expects (it compares to Date.now()/1000). */
export function epochSeconds(at: Date): number {
  return at.getTime() / 1000;
}

/** The score actually shown to the player: guess points minus hint costs, floored at 0.
 *  Floored *here*, at every point of use, rather than stored as one pre-floored column —
 *  `max(0, max(0,x)+s)` diverges from `max(0,x+s)` once x has gone negative, so a value
 *  that was floored before a new guess was added would let the score visibly jump back
 *  down on the next read. Keeping both raw components and flooring on each computation
 *  keeps every reading consistent regardless of how many hints or guesses came first. */
export function effectiveScore(rawGuessScore: number, hintCostTotal: number): number {
  return Math.max(0, rawGuessScore - hintCostTotal);
}

export async function loadGame(sql: Sql, gameId: string): Promise<GameRow | null> {
  // A malformed id must read as "no such game", not as a 500 from Postgres' uuid parser.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(gameId)) {
    return null;
  }
  const [game] = await sql<GameRow[]>`
    select g.id, g.wordlist_id, g.player_id, g.target_word, g.target_length, g.scrambled_letters,
           g.possible_count, g.found_count, g.status, g.ends_at, g.daily_puzzle_id, g.room_id,
           coalesce((select sum(score)::int from game_guesses
                      where game_id = g.id and correct), 0) as raw_guess_score,
           coalesce((select sum(cost)::int from game_hints
                      where game_id = g.id), 0) as hint_cost_total
      from games g
     where g.id = ${gameId}
  `;
  return game ?? null;
}

/** The effective status: an active game whose deadline has passed is expired, whether or
 *  not anything has written that to the row yet. */
export function effectiveStatus(game: GameRow, now: Date): string {
  if (game.status === "active" && now > game.ends_at) return "expired";
  return game.status;
}

/** The words findable on this board: those whose signature is a sub-multiset of the
 *  board's letters. One indexed lookup, ~99 signatures for a 7-letter board. `minLength`
 *  is the admin-editable config value (lib/config.ts) — every caller below fetches config
 *  once and passes the same value it uses for its own guess-length check, so a board's
 *  possible-word set and its guess-acceptance threshold never disagree within one request. */
export async function findableWords(
  sql: Sql,
  listId: number,
  target: string,
  minLength: number,
): Promise<string[]> {
  const signatures = subSignatures(signatureOf(target), minLength);
  const rows = await sql<{ word: string }[]>`
    select word from words
     where wordlist_id = ${listId} and active and signature = any(${signatures})
     order by word
  `;
  return rows.map((row) => row.word);
}

/** A game whose deadline has passed but is still marked 'active' gets finalized the
 *  first time any endpoint notices — guess(), giveUp(), and getPossibleWords() (the
 *  reveal the frontend fetches right after its countdown hits zero) all call this before
 *  doing anything else. Only the invocation whose UPDATE actually flips the row runs
 *  finalizeWordStats, so two concurrent finalizers can't double-count it. */
export async function finalizeExpiry(sql: Sql, game: GameRow, now: Date, config: GameConfig): Promise<void> {
  if (game.status !== "active" || now <= game.ends_at) return;
  const finalScore = effectiveScore(game.raw_guess_score, game.hint_cost_total);
  const result = await sql`
    update games set status = 'expired', ended_at = now(), final_score = ${finalScore}
     where id = ${game.id} and status = 'active'
  `;
  if (result.count > 0) await finalizeWordStats(sql, game, config);
}

/** Runs once, at a game's true terminal transition (a full clear inside guess(), a
 *  lazily-discovered timeout in finalizeExpiry, or an explicit giveUp) — updates
 *  word_stats for the target word: times_failed if it was never actually found this game
 *  (skipped for a full clear, which always found it — the target is itself always one of
 *  its own findable words), then applyGameMastery using this game's own letter-weighted
 *  find rate (ROADMAP Batch 10 item 3's KNOWN CORRECTION fix). By the time this runs,
 *  recordSolved has already fired at find-time if the target was found, so
 *  applyGameMastery's word_stats row always exists either way. */
export async function finalizeWordStats(sql: Sql, game: GameRow, config: GameConfig): Promise<void> {
  const [solved] = await sql<{ x: number }[]>`
    select 1 as x from game_guesses
     where game_id = ${game.id} and word = ${game.target_word} and correct
     limit 1
  `;
  if (!solved) await recordFailed(sql, game.player_id, game.wordlist_id, game.target_word);

  const possible = await findableWords(sql, game.wordlist_id, game.target_word, config.min_word_length);
  const foundRows = await sql<{ word: string }[]>`
    select word from game_guesses where game_id = ${game.id} and correct
  `;
  const foundWords = foundRows.map((row) => row.word);
  const fraction = letterClearFraction(possible, foundWords);
  await applyGameMastery(sql, game.player_id, game.wordlist_id, game.target_word, fraction);

  // One read of the just-written row, shared by the daily grade and the achievement
  // evaluation below. `status` is authoritative for "was this a full board clear"
  // ('finished'); a length comparison against `possible` would be wrong, since a findable
  // word can be deactivated mid-game (ROADMAP 4.1) and shrink that list. `final_score`
  // and `hint_count` are likewise final by now — every caller wrote final_score in the
  // statement right before calling this (the full-clear UPDATE in the same statement).
  const [after] = await sql<{ status: string; final_score: number | null; hint_count: number }[]>`
    select g.status, g.final_score,
           (select count(*)::int from game_hints where game_id = g.id) as hint_count
      from games g where g.id = ${game.id}
  `;

  // ROADMAP Batch 10 item 1: a daily-puzzle game grades its result here — the one place
  // all three terminal transitions already pass through. `completed` = the target word
  // was found (the same `solved` check above), not a full board clear. `on conflict do
  // nothing` on the (puzzle, player) unique index means only the first attempt to reach a
  // terminal state is recorded — later replays still play, but don't overwrite the
  // streak/leaderboard result. Anonymous players (no player_id) aren't graded: a streak
  // needs a stable identity.
  if (game.daily_puzzle_id && game.player_id) {
    await sql`
      insert into daily_results (puzzle_id, player_id, game_id, completed, final_score)
      values (${game.daily_puzzle_id}, ${game.player_id}, ${game.id},
              ${Boolean(solved)}, ${after?.final_score ?? 0})
      on conflict (puzzle_id, player_id) do nothing
    `;
  }

  // ROADMAP Batch 10 item 10: evaluate + persist achievements. After the daily grade
  // above, so a just-completed daily counts toward streak achievements. No-op for an
  // anonymous player. Return value (newly-unlocked keys) is unused here — the frontend
  // re-fetches GET /api/v1/me/achievements at game end and toasts the diff.
  await evaluateAchievements(sql, game, {
    foundWords,
    status: after?.status ?? game.status,
    hintCount: after?.hint_count ?? 0,
  });
}
