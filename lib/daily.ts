/**
 * Daily puzzle + streaks (ROADMAP Batch 10 item 1).
 *
 * A "daily puzzle" is one shared board per calendar day per (wordlist, length): every
 * player who starts today's puzzle for a given combo gets the exact same scrambled
 * letters and target word. Playing it creates an ordinary `games` row with
 * `daily_puzzle_id` set — every existing mechanic (guess/give_up/hints/timer/expiry)
 * then operates on it unchanged. The only extra behaviour is in lib/game.ts's
 * `finalizeWordStats`, which writes one `daily_results` row at the game's terminal
 * transition.
 *
 * Design decisions (confirmed with the project owner, 2026-08-29):
 *   - per-(wordlist, length) puzzle, not one global canonical daily
 *   - day boundary in Europe/Budapest, computed in SQL (no JS timezone math)
 *   - a streak day = that day's puzzle *completed* (target word found), not merely played
 *   - one graded attempt per day; replayable for fun, but only the first attempt to reach
 *     a terminal state counts for the streak / leaderboard
 *
 * Why "completed" = target found (not `status='finished'`): a Betűvető game only reaches
 * 'finished' on a full board clear (found_count >= possible_count), which is rare — using
 * that would make streaks near-unreachable.
 */
import type { Sql } from "postgres";
import { getConfig, getUiConfig } from "./config.js";
import { DEFAULT_WORDLIST_CODE, db, wordlistAlphabet, wordlistId } from "./db.js";
import { type Reply, findableWords } from "./game.js";
import { type StreakInfo, computeStreak } from "./streak.js";
import {
  MAX_TARGET_LENGTH,
  MIN_TARGET_LENGTH,
  durationForLength,
  scrambleWord,
} from "./words.js";

// A null/blank display_name is common (Batch 2.1 made it optional) — mirror lib/scores.ts
// so a daily leaderboard row is never blank.
const ANONYMOUS_DISPLAY_NAME = "Névtelen játékos";

/** Seconds since the epoch, matching the shape the rest of the API returns timestamps in. */
function epochSeconds(at: Date): number {
  return at.getTime() / 1000;
}

interface DailyPuzzleRow {
  id: number;
  puzzle_date: string; // 'YYYY-MM-DD' (::date rendered as text)
  wordlist_id: number;
  target_length: number;
  target_word: string;
  scrambled_letters: string;
  possible_count: number;
}

/** ROADMAP Batch 10 item 14: an admin can hide the length / wordlist selectors, which
 *  also pins their value server-side in game/start. The daily path must apply the same
 *  forcing, or a hidden selector would be bypassable here. Returns the resolved axes plus
 *  the ui config (the start response echoes the same `ui` block game/start does). */
async function resolveDailyAxes(
  wordlistCodeRaw: string | undefined,
  targetLengthRaw: number,
): Promise<{
  ui: Awaited<ReturnType<typeof getUiConfig>>;
  wordlistCode: string;
  targetLength: number;
}> {
  const ui = await getUiConfig();
  let wordlistCode = wordlistCodeRaw ?? DEFAULT_WORDLIST_CODE;
  let targetLength = targetLengthRaw;
  if (!ui.show_length_selector) targetLength = ui.default_length;
  if (!ui.show_wordlist_selector) wordlistCode = ui.default_wordlist;
  return { ui, wordlistCode, targetLength };
}

/** Today's puzzle row for (listId, targetLength), generating it on first request.
 *
 *  The pick is a plain uniform draw — a daily puzzle is one word for *everyone*, so
 *  startGame's per-player `pickPersonalizedWord` (which prefers words this player hasn't
 *  seen and excludes their mastery cooldown) must NOT be used here.
 *
 *  Generation is race-safe against two concurrent first-requests: `insert ... on conflict
 *  do nothing` lets exactly one win, then the unconditional `select` returns the row that
 *  actually persisted — this function never returns its own pre-insert pick. Same class of
 *  fix as the `found_count` check-then-act bug this repo already hit. */
async function getOrCreateTodaysPuzzle(
  sql: Sql,
  listId: number,
  targetLength: number,
  minWordLength: number,
): Promise<DailyPuzzleRow | null> {
  const selectToday = () => sql<DailyPuzzleRow[]>`
    select id, puzzle_date::text as puzzle_date, wordlist_id, target_length,
           target_word, scrambled_letters, possible_count
      from daily_puzzles
     where puzzle_date = (now() at time zone 'Europe/Budapest')::date
       and wordlist_id = ${listId}
       and target_length = ${targetLength}
  `;

  const [existing] = await selectToday();
  if (existing) return existing;

  const [pick] = await sql<{ word: string }[]>`
    select word from words
     where wordlist_id = ${listId} and length = ${targetLength} and active
     order by random()
     limit 1
  `;
  if (!pick) return null;

  const possible = await findableWords(sql, listId, pick.word, minWordLength);
  const scrambled = scrambleWord(pick.word);

  await sql`
    insert into daily_puzzles (puzzle_date, wordlist_id, target_length, target_word,
                               scrambled_letters, possible_count)
    values ((now() at time zone 'Europe/Budapest')::date, ${listId}, ${targetLength},
            ${pick.word}, ${scrambled}, ${possible.length})
    on conflict (puzzle_date, wordlist_id, target_length) do nothing
  `;

  const [row] = await selectToday();
  return row ?? null;
}

interface DailyLeaderEntry {
  display_name: string;
  final_score: number;
  completed: boolean;
}

/** Top scores for one daily puzzle. Excludes admin-disqualified games (ROADMAP 5.2 item
 *  3), same as the all-time leaderboard in lib/scores.ts. */
async function dailyLeaderboard(sql: Sql, puzzleId: number): Promise<DailyLeaderEntry[]> {
  const rows = await sql<
    { display_name: string | null; final_score: number; completed: boolean }[]
  >`
    select p.display_name, dr.final_score, dr.completed
      from daily_results dr
      left join players p on p.id = dr.player_id
      join games g on g.id = dr.game_id
     where dr.puzzle_id = ${puzzleId}
       and g.disqualified_at is null
     order by dr.final_score desc
     limit 10
  `;
  return rows.map((row) => ({
    display_name: row.display_name?.trim() || ANONYMOUS_DISPLAY_NAME,
    final_score: row.final_score,
    completed: row.completed,
  }));
}

function outOfRange(targetLength: number): Reply | null {
  if (
    !Number.isInteger(targetLength) ||
    targetLength < MIN_TARGET_LENGTH ||
    targetLength > MAX_TARGET_LENGTH
  ) {
    return {
      status: 422,
      body: {
        detail: `target_length must be an integer between ${MIN_TARGET_LENGTH} and ${MAX_TARGET_LENGTH}.`,
      },
    };
  }
  return null;
}

/** GET /api/v1/daily — today's puzzle meta, this player's result (if any), their streak,
 *  and the daily leaderboard. Never returns the scrambled letters or target word: the
 *  board is only handed out by daily/start, the same way a live game never leaks its
 *  target. */
export async function getDailyView(
  playerId: string | null,
  wordlistCodeRaw: string | undefined,
  targetLengthRaw: number,
): Promise<Reply> {
  const sql = db();
  const config = await getConfig();
  const { wordlistCode, targetLength } = await resolveDailyAxes(wordlistCodeRaw, targetLengthRaw);

  const rangeError = outOfRange(targetLength);
  if (rangeError) return rangeError;

  const listId = await wordlistId(wordlistCode);
  const puzzle = await getOrCreateTodaysPuzzle(sql, listId, targetLength, config.min_word_length);
  if (!puzzle) {
    return { status: 404, body: { detail: `No words found with length ${targetLength}` } };
  }

  let yourResult: { completed: boolean; final_score: number } | null = null;
  let streak: StreakInfo = { current: 0, best: 0 };
  if (playerId) {
    const [row] = await sql<{ completed: boolean; final_score: number }[]>`
      select completed, final_score from daily_results
       where puzzle_id = ${puzzle.id} and player_id = ${playerId}
    `;
    if (row) yourResult = { completed: row.completed, final_score: row.final_score };
    streak = await computeStreak(sql, playerId);
  }

  const leaderboard = await dailyLeaderboard(sql, puzzle.id);

  return {
    status: 200,
    body: {
      puzzle_date: puzzle.puzzle_date,
      wordlist: wordlistCode,
      target_length: puzzle.target_length,
      possible_count: puzzle.possible_count,
      already_played: yourResult !== null,
      your_result: yourResult,
      streak,
      leaderboard,
    },
  };
}

/** POST /api/v1/daily/start — start (or replay) today's puzzle. Returns the same body
 *  shape as game/start so the frontend reuses its whole game flow, plus a `daily` block.
 *  `already_graded` tells the client this is a replay whose result won't count. */
export async function startDailyGame(
  playerId: string,
  // Only set when the caller minted a fresh identity this request (see startGameRoute).
  setCookieHeader: string | undefined,
  wordlistCodeRaw: string | undefined,
  targetLengthRaw: number,
  country: string | undefined,
): Promise<Reply> {
  const sql = db();
  const config = await getConfig();
  const { ui, wordlistCode, targetLength } = await resolveDailyAxes(wordlistCodeRaw, targetLengthRaw);

  const rangeError = outOfRange(targetLength);
  if (rangeError) return rangeError;

  const listId = await wordlistId(wordlistCode);
  const alphabet = await wordlistAlphabet(wordlistCode);
  const puzzle = await getOrCreateTodaysPuzzle(sql, listId, targetLength, config.min_word_length);
  if (!puzzle) {
    return { status: 404, body: { detail: `No words found with length ${targetLength}` } };
  }

  if (setCookieHeader) {
    await sql`insert into players (id) values (${playerId}) on conflict do nothing`;
  }

  const [graded] = await sql<{ x: number }[]>`
    select 1 as x from daily_results
     where puzzle_id = ${puzzle.id} and player_id = ${playerId}
     limit 1
  `;

  // Full length-scaled duration, no client override — a daily game is once a day and
  // shared, so there is no need for the shorter-timer handling game/start has for tests.
  const duration = durationForLength(
    puzzle.target_length,
    config.timer_base_seconds,
    config.timer_seconds_per_extra_length,
  );

  const [game] = await sql<{ id: string; ends_at: Date }[]>`
    insert into games (player_id, wordlist_id, target_word, target_length, scrambled_letters,
                       possible_count, ends_at, country, daily_puzzle_id)
    values (${playerId}, ${listId}, ${puzzle.target_word}, ${puzzle.target_length},
            ${puzzle.scrambled_letters}, ${puzzle.possible_count},
            now() + ${`${duration} seconds`}::interval, ${country ?? null}, ${puzzle.id})
    returning id, ends_at
  `;

  return {
    status: 200,
    body: {
      game_id: game.id,
      wordlist: wordlistCode,
      alphabet,
      scrambled_letters: puzzle.scrambled_letters,
      target_length: puzzle.target_length,
      game_active: true,
      ends_at: epochSeconds(game.ends_at),
      duration_seconds: duration,
      possible_count: puzzle.possible_count,
      // A daily game is always a normal-difficulty pick.
      difficulty: "normal",
      ui: {
        show_length_selector: ui.show_length_selector,
        show_wordlist_selector: ui.show_wordlist_selector,
        show_easy_mode: ui.show_easy_mode,
      },
      player_id: playerId,
      daily: {
        puzzle_date: puzzle.puzzle_date,
        // A replay after the first graded attempt still plays, but won't overwrite the
        // recorded result — the frontend uses this to say so.
        already_graded: Boolean(graded),
      },
    },
    ...(setCookieHeader ? { headers: { "Set-Cookie": setCookieHeader } } : {}),
  };
}
