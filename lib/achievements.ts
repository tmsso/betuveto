/**
 * Achievements (ROADMAP Batch 10 item 10).
 *
 * The catalog is code-defined (below), not a table — the set is small and versioned with
 * the app, and each key needs a matching predicate anyway. `player_achievements`
 * (migrations/0019) stores one row per (player, key) at first-earn time.
 *
 * `evaluateAchievements` is the single write path: lib/game.ts's `finalizeWordStats`
 * calls it once at every game's true terminal transition (full clear / lazy timeout /
 * give-up), after the daily-result grade, so a just-completed daily counts toward streak
 * achievements. `getMyAchievements` is the single read path (GET /api/v1/me/achievements).
 *
 * Awards are forward-only (project owner's call, 2026-09-01): no retroactive backfill.
 * The cumulative predicates (games_100, streaks, daily_both_wordlists) still catch up on a
 * player's next terminal game because they count current state; the point-in-time ones
 * (first_word, ten_letter_word, full_clear*) only fire on a game played after this ships.
 *
 * Anonymous players (no player_id) never unlock anything — a stable identity is required,
 * same as streaks. They still see the full catalog (all locked) via getMyAchievements.
 *
 * Badge copy is deliberately word-agnostic (see i18n `achievements.*`): the standing
 * product rule is that a player is never shown their own per-word history
 * (betuveto-no-player-facing-word-history), so "found a 10-letter word" never names the
 * word, in the badge or the unlock toast.
 */
import type { Sql } from "postgres";
import { db } from "./db.js";
import type { GameRow, Reply } from "./game.js";
import { computeStreak } from "./streak.js";
import { letterCount } from "./words.js";

/** The full achievement catalog, in display order. Each key has matching i18n entries
 *  (`achievements.<key>.name` / `.desc`) in frontend/src/i18n/locales/{hu,en}.json. */
export const ACHIEVEMENT_KEYS = [
  "first_word",
  "ten_letter_word",
  "full_clear",
  "full_clear_no_hints",
  "daily_streak_7",
  "daily_streak_30",
  "games_100",
  "daily_both_wordlists",
] as const;

export type AchievementKey = (typeof ACHIEVEMENT_KEYS)[number];

/** The minimum letter count (Hungarian-digraph-aware, via `letterCount`) that counts as a
 *  "long word" for `ten_letter_word`. */
const LONG_WORD_LETTERS = 10;

/** Signals a terminal transition already knows, passed in rather than re-queried. */
export interface TerminalFacts {
  /** This game's correct guesses (raw words). */
  foundWords: string[];
  /** The game row's status *after* the terminal UPDATE — 'finished' means a full clear. */
  status: string;
  /** Number of hints taken in this game. */
  hintCount: number;
}

interface AchievementRow {
  key: AchievementKey;
  unlocked_at: string | null;
}

/**
 * Evaluate every achievement predicate for `game.player_id` at a terminal transition and
 * persist any newly-earned keys. Returns the keys that were newly inserted this call (for
 * a caller that wants to surface an unlock) — an already-held key is not returned.
 */
export async function evaluateAchievements(
  sql: Sql,
  game: GameRow,
  facts: TerminalFacts,
): Promise<AchievementKey[]> {
  const playerId = game.player_id;
  if (!playerId) return [];

  const earned = new Set<AchievementKey>();

  // --- point-in-time: judged from this game alone -------------------------------------
  if (facts.foundWords.length > 0) earned.add("first_word");
  if (facts.foundWords.some((w) => letterCount(w) >= LONG_WORD_LETTERS)) {
    earned.add("ten_letter_word");
  }
  const fullClear = facts.status === "finished";
  if (fullClear) earned.add("full_clear");
  if (fullClear && facts.hintCount === 0) earned.add("full_clear_no_hints");

  // --- cumulative: current state across all this player's games -----------------------
  // This game has already been written to its terminal status by the caller, so it is
  // included in the count.
  const [{ terminal_games }] = await sql<{ terminal_games: number }[]>`
    select count(*)::int as terminal_games
      from games
     where player_id = ${playerId} and status <> 'active'
  `;
  if (terminal_games >= 100) earned.add("games_100");

  // Daily-only predicates: skip the streak/wordlist queries entirely for a non-daily game.
  if (game.daily_puzzle_id) {
    const streak = await computeStreak(sql, playerId);
    if (streak.current >= 7) earned.add("daily_streak_7");
    if (streak.current >= 30) earned.add("daily_streak_30");

    const [{ wordlists_completed }] = await sql<{ wordlists_completed: number }[]>`
      select count(distinct dp.wordlist_id)::int as wordlists_completed
        from daily_results dr
        join daily_puzzles dp on dp.id = dr.puzzle_id
       where dr.player_id = ${playerId} and dr.completed
    `;
    if (wordlists_completed >= 2) earned.add("daily_both_wordlists");
  }

  if (earned.size === 0) return [];

  const rows = await sql<{ achievement_key: AchievementKey }[]>`
    insert into player_achievements ${sql(
      [...earned].map((key) => ({ player_id: playerId, achievement_key: key })),
    )}
    on conflict do nothing
    returning achievement_key
  `;
  return rows.map((r) => r.achievement_key);
}

/**
 * GET /api/v1/me/achievements — the full catalog with each key's unlock timestamp (null
 * if not yet earned). A missing/blank identity reads as "everything locked" rather than
 * an error, so an anonymous player still sees what there is to earn.
 */
export async function getMyAchievements(playerId: string | null): Promise<Reply> {
  const unlockedAt = new Map<string, string>();
  if (playerId) {
    const sql = db();
    const rows = await sql<{ achievement_key: string; unlocked_at: Date }[]>`
      select achievement_key, unlocked_at from player_achievements where player_id = ${playerId}
    `;
    for (const row of rows) unlockedAt.set(row.achievement_key, row.unlocked_at.toISOString());
  }

  return {
    status: 200,
    body: {
      achievements: ACHIEVEMENT_KEYS.map((key) => ({
        key,
        unlocked_at: unlockedAt.get(key) ?? null,
      })),
    },
  };
}
