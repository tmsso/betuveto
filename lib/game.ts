/**
 * Game logic — the port of backend/main.py's GameManager to a server-authoritative,
 * database-backed model (ROADMAP Batch 1.2).
 *
 * There is no in-process state: every game lives in the `games` table and every scored
 * guess in `game_guesses`, so any function instance can serve any request and a redeploy
 * mid-game loses nothing. The target word and the solution list never leave the server
 * while a game is active (ROADMAP 0.1).
 *
 * Each function returns { status, body } rather than writing to a response, so the HTTP
 * adapters in api/ stay trivial and the contract can be tested without a server.
 */
import type { Sql } from "postgres";
import { type GameConfig, getConfig, getUiConfig } from "./config.js";
import { DEFAULT_WORDLIST_CODE, db, wordlistAlphabet, wordlistId } from "./db.js";
import {
  MAX_TARGET_LENGTH,
  MIN_TARGET_LENGTH,
  MIN_WORDS_PER_LENGTH,
  canFormWord,
  durationForLength,
  letterClearFraction,
  letterCount,
  normalizeGuess,
  scoreFor,
  scrambleWord,
  signatureOf,
  subSignatures,
} from "./words.js";
import {
  applyGameMastery,
  pickEasyWord,
  pickPersonalizedWord,
  recordFailed,
  recordSolved,
} from "./word-stats.js";
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
function epochSeconds(at: Date): number {
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
           g.possible_count, g.found_count, g.status, g.ends_at, g.daily_puzzle_id,
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
async function finalizeExpiry(sql: Sql, game: GameRow, now: Date, config: GameConfig): Promise<void> {
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
async function finalizeWordStats(sql: Sql, game: GameRow, config: GameConfig): Promise<void> {
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

export async function startGame(
  targetLength: number,
  durationSeconds: number | undefined,
  playerId: string,
  // Only set when the caller minted a fresh identity this request — signals both "create
  // the players row" and "echo the Set-Cookie back", so the two can never drift apart.
  setCookieHeader?: string,
  wordlistCode?: string,
  // ROADMAP Batch 10 "easy mode": any value other than exactly "easy" plays normally, the
  // same permissive convention as an unrecognised query param elsewhere in this API — no
  // 422 branch needed for a value whose worst case is just "played the normal way".
  difficultyMode?: string,
  // ROADMAP Batch 10 item 13: two-letter country code from Vercel's geo header, or
  // undefined (local dev, or the header absent) — admin-only aggregate use, never echoed
  // back to the client.
  country?: string,
): Promise<Reply> {
  const sql = db();
  const config = await getConfig();

  // ROADMAP Batch 10 item 14: an admin can hide any of the three start-screen controls.
  // A hidden control is a fixed axis for everyone — ignore whatever the client sent (and,
  // since this runs before either would be read, any saved per-player preference too) and
  // pin the configured default. Runs before the range check below so a client that still
  // sends an out-of-range target_length for a hidden selector is corrected, not 422'd.
  const ui = await getUiConfig();
  if (!ui.show_length_selector) targetLength = ui.default_length;
  if (!ui.show_wordlist_selector) wordlistCode = ui.default_wordlist;
  if (!ui.show_easy_mode) difficultyMode = "normal";

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

  if (durationSeconds !== undefined && !Number.isInteger(durationSeconds)) {
    return { status: 422, body: { detail: "duration_seconds must be an integer." } };
  }

  // Longer boards have (combinatorially) many more findable words, so the ceiling itself
  // scales with length (ROADMAP 2.3, admin-editable via lib/config.ts). Below that ceiling,
  // clamped so a client can shorten its own timer (which the tests use to exercise expiry)
  // but never lengthen it — a shorter clock is only ever a handicap, never an advantage.
  const maxDuration = durationForLength(
    targetLength,
    config.timer_base_seconds,
    config.timer_seconds_per_extra_length,
  );
  const duration =
    durationSeconds === undefined
      ? maxDuration
      : Math.min(Math.max(durationSeconds, 5), maxDuration);

  const listId = await wordlistId(wordlistCode);
  // Free — wordlistId() and wordlistAlphabet() share the same per-code cache entry
  // (lib/db.ts), so this doesn't cost a second query once the id above has been resolved.
  const alphabet = await wordlistAlphabet(wordlistCode);

  if (setCookieHeader) {
    // Explicit id: the column default (gen_random_uuid()) exists for callers that don't
    // care which id they get, but this one must match the cookie already being minted.
    await sql`insert into players (id) values (${playerId})`;
  }

  // Target selection (product decision 2026-07-30, replacing the old plain uniform-random
  // draw): server-side only, never surfaced to the player as history. "Easy mode"
  // (optional, ROADMAP Batch 10) biases toward words with a proven-high *aggregate*
  // success rate across all players; pickEasyWord returns null (falling through) when
  // nothing yet qualifies — as of 2026-07-30 that's the common case at this project's
  // traffic, per MIN_ATTEMPTS_FOR_DIFFICULTY's own comment in lib/word-stats.ts, not an
  // edge case. Every game (easy mode or not) then goes through pickPersonalizedWord: a
  // word this player hasn't seen before is preferred, and a word they've personally
  // mastered (>=90% solved) is excluded from being their target again for ~100 games —
  // "shouldn't come up again" is a rule for every game, not just the default path. A
  // plain uniform pick is the ultimate fallback, only reached if literally every active
  // word of this length is in this player's own cooldown right now.
  let target = difficultyMode === "easy" ? await pickEasyWord(sql, listId, targetLength, playerId) : null;
  const actualDifficulty = target ? "easy" : "normal";
  if (!target) {
    target = await pickPersonalizedWord(sql, listId, targetLength, playerId);
  }
  if (!target) {
    const [pick] = await sql<{ word: string }[]>`
      select word from words
       where wordlist_id = ${listId} and length = ${targetLength} and active
       order by random()
       limit 1
    `;
    target = pick?.word ?? null;
  }
  if (!target) {
    return { status: 404, body: { detail: `No words found with length ${targetLength}` } };
  }
  const possible = await findableWords(sql, listId, target, config.min_word_length);
  const scrambled = scrambleWord(target);

  const [game] = await sql<{ id: string; ends_at: Date }[]>`
    insert into games (player_id, wordlist_id, target_word, target_length, scrambled_letters,
                       possible_count, ends_at, country)
    values (${playerId}, ${listId}, ${target}, ${targetLength}, ${scrambled},
            ${possible.length}, now() + ${`${duration} seconds`}::interval, ${country ?? null})
    returning id, ends_at
  `;

  return {
    status: 200,
    body: {
      game_id: game.id,
      wordlist: wordlistCode ?? DEFAULT_WORDLIST_CODE,
      // Accepted on-screen-keyboard letters for this game's language (ROADMAP 6.2) —
      // replaces the frontend's old hardcoded Hungarian-only whitelist.
      alphabet,
      scrambled_letters: scrambled,
      target_length: targetLength,
      game_active: true,
      ends_at: epochSeconds(game.ends_at),
      duration_seconds: duration,
      possible_count: possible.length,
      // What actually happened, not just what was requested: an "easy" request silently
      // falls back to "normal" when no word yet qualifies (see the pick above) — echoing
      // the real outcome keeps the client from claiming an easy-mode game that isn't one.
      difficulty: actualDifficulty,
      // ROADMAP Batch 10 item 14: which start-screen controls the frontend should render.
      // The forced *values* for any hidden control are already carried by target_length /
      // wordlist / difficulty above, so only the booleans are needed here.
      ui: {
        show_length_selector: ui.show_length_selector,
        show_wordlist_selector: ui.show_wordlist_selector,
        show_easy_mode: ui.show_easy_mode,
      },
      // Not the auth token itself (that stays HttpOnly) — just the id, so a black-box
      // test (or a future /me endpoint) can assert continuity across requests.
      player_id: playerId,
    },
    ...(setCookieHeader ? { headers: { "Set-Cookie": setCookieHeader } } : {}),
  };
}

export async function guess(gameId: string, rawWord: string): Promise<Reply> {
  const sql = db();
  const config = await getConfig();
  const game = await loadGame(sql, gameId);
  if (!game) return NOT_FOUND;

  const now = new Date();
  await finalizeExpiry(sql, game, now, config);
  const status = effectiveStatus(game, now);

  if (status === "expired") {
    return {
      status: 200,
      body: {
        valid: false,
        can_form: false,
        already_guessed: false,
        score: 0,
        // ROADMAP 6.2: the backend returns a machine-readable code, not display text —
        // the frontend maps result -> localised copy via its i18n catalog.
        result: "time_expired",
        game_ended: true,
        total_score: effectiveScore(game.raw_guess_score, game.hint_cost_total),
        found_count: game.found_count,
      },
    };
  }

  if (status !== "active") {
    return { status: 400, body: { detail: "Game is not active. Start a new game." } };
  }

  const word = normalizeGuess(rawWord);
  // `valid` = "this is a real word"; `can_form` = "and this board can spell it".
  const reject = (result: string, valid = false, extra?: Record<string, unknown>): Reply => ({
    status: 200,
    body: {
      valid,
      can_form: false,
      already_guessed: false,
      score: 0,
      result,
      game_ended: false,
      ...extra,
    },
  });

  if (letterCount(word) < config.min_word_length) {
    return reject("too_short", false, { min_length: config.min_word_length });
  }

  // The target itself stays guessable even if a word report (ROADMAP 4.1) deactivated it
  // mid-game — "don't yank a live game's target" — every other word obeys the normal
  // active flag. (A *non-target* findable word going inactive mid-game is a rarer edge
  // case this doesn't cover: found_count could then never reach the frozen possible_count,
  // making the completion bonus unreachable for that one game — accepted as out of scope.)
  const [known] = await sql<{ word: string }[]>`
    select word from words
     where wordlist_id = ${game.wordlist_id} and word = ${word}
       and (active or word = ${game.target_word})
  `;
  if (!known) return reject("not_in_dictionary");

  if (!canFormWord(word, game.target_word)) {
    // A real word, just not one this board can spell: valid, but not formable.
    return reject("cannot_form", true);
  }

  const score = scoreFor(word);

  // Insert-first dedupe: the unique index on (game_id, word) where correct makes the
  // "already guessed?" check atomic, so a double-submitted word cannot score twice even
  // if two invocations race.
  const inserted = await sql<{ id: number }[]>`
    insert into game_guesses (game_id, word, correct, score)
    values (${game.id}, ${word}, true, ${score})
    on conflict do nothing
    returning id
  `;

  if (inserted.length === 0) {
    return {
      status: 200,
      body: {
        valid: true,
        can_form: true,
        already_guessed: true,
        score: 0,
        result: "already_guessed",
        // Previously only carried in the now-removed display string — the frontend needs
        // the number itself to render "you scored N already" in either language.
        total_score: effectiveScore(game.raw_guess_score, game.hint_cost_total),
        game_ended: false,
      },
    };
  }

  // Anti-cheat baseline (ROADMAP 2.2): more than config.guess_rate_limit_per_second correct
  // guesses from one player in a second means a script working through a locally-computed
  // word list, not a human — the scrambled letters are public, so a bot can compute the
  // findable set itself without ever needing the server to leak it. Checked *after* this
  // guess is already committed: count this player's own correct guesses across the last
  // second, across every game.
  // Checking before inserting is a check-then-act race — concurrent requests (a bot
  // firing many at once, not one-by-one) can all read "0 so far" before any of them have
  // committed. Counting post-insert means every sibling's commit is visible by the time
  // each one checks, so the number of guesses that survive the window is genuinely
  // bounded even under true concurrency (which exact one gets rejected isn't strictly
  // first-come-first-served, but the rate is actually capped, which is what matters here).
  if (game.player_id) {
    const [{ count }] = await sql<{ count: number }[]>`
      select count(*)::int as count
        from game_guesses gg join games g on g.id = gg.game_id
       where g.player_id = ${game.player_id} and gg.correct
         and gg.created_at >= now() - interval '1 second'
    `;
    if (count > config.guess_rate_limit_per_second) {
      await sql`delete from game_guesses where id = ${inserted[0].id}`;
      return { status: 429, body: { detail: "Túl sok tipp túl gyorsan. Lassíts egy kicsit." } };
    }
  }

  // The target word itself, found for the first time — record it as solved (ROADMAP 3.3)
  // regardless of whether this same guess also happens to clear the whole board.
  if (word === game.target_word) {
    await recordSolved(sql, game.player_id, game.wordlist_id, word);
  }

  const totalScore = effectiveScore(game.raw_guess_score + score, game.hint_cost_total);
  // Floored at 0: the game could theoretically end in the same instant as its last second.
  const remainingSeconds = Math.max(0, Math.floor((game.ends_at.getTime() - now.getTime()) / 1000));

  // found_count = found_count + 1 is computed by Postgres itself, not from the JS-held
  // `game.found_count` read at the top of this function — a pre-existing bug (not
  // introduced here) let two concurrent guesses on the same board both derive
  // found_count+1 from the same stale read, so the second one silently overwrote the
  // first's increment. Row-level locking on a single UPDATE statement serializes this
  // for free. Likewise final_score, on the row that turns out to finish the game, is
  // computed from a fresh sum over game_guesses/game_hints in the same statement rather
  // than the JS-held raw_guess_score/hint_cost_total — those were read before this
  // request's own insert and so can't see a concurrent sibling's simultaneous find.
  const [row] = await sql<{ found_count: number; game_ended: boolean; final_score: number | null }[]>`
    update games
       set found_count = found_count + 1,
           status      = case when found_count + 1 >= possible_count then 'finished' else status end,
           ended_at    = case when found_count + 1 >= possible_count then now() else ended_at end,
           final_score = case when found_count + 1 >= possible_count
                              then greatest(0,
                                     (select coalesce(sum(score)::int, 0) from game_guesses
                                       where game_id = games.id and correct)
                                     - (select coalesce(sum(cost)::int, 0) from game_hints
                                         where game_id = games.id)
                                   ) + ${remainingSeconds * config.completion_bonus_multiplier}
                              else final_score end
     where id = ${game.id}
     returning found_count, (found_count >= possible_count) as game_ended, final_score
  `;
  const foundCount = row.found_count;
  const gameEnded = row.game_ended;
  // A full clear is a game's terminal transition too, same as a lazily-discovered timeout
  // or an explicit give-up — apply the same word_stats finalization here. Always finds
  // solved=true internally (a full clear can't happen without the target itself having
  // been found, at this guess or an earlier one), so this only ever touches mastery, never
  // times_failed.
  if (gameEnded) await finalizeWordStats(sql, game, config);
  const completionBonus = gameEnded ? remainingSeconds * config.completion_bonus_multiplier : 0;
  // gameEnded's final_score comes straight back from the row just persisted (see the
  // comment above the UPDATE) rather than being recomputed here from the pre-insert
  // `totalScore`, so the response body can never disagree with what actually got saved.
  const finalScore = gameEnded ? row.final_score! : totalScore;

  return {
    status: 200,
    body: {
      valid: true,
      can_form: true,
      already_guessed: false,
      score,
      result: "correct",
      game_ended: gameEnded,
      is_full_length: letterCount(word) === game.target_length,
      is_target: word === game.target_word,
      total_score: gameEnded ? finalScore : totalScore,
      completion_bonus: completionBonus,
      found_count: foundCount,
    },
  };
}

export async function giveUp(gameId: string): Promise<Reply> {
  const sql = db();
  const game = await loadGame(sql, gameId);
  if (!game) return NOT_FOUND;
  const config = await getConfig();

  if (game.status === "active") {
    const finalScore = effectiveScore(game.raw_guess_score, game.hint_cost_total);
    const result = await sql`
      update games
         set status = 'given_up', ended_at = now(), final_score = ${finalScore}
       where id = ${game.id} and status = 'active'
    `;
    if (result.count > 0) await finalizeWordStats(sql, game, config);
  }

  const possible = await findableWords(sql, game.wordlist_id, game.target_word, config.min_word_length);
  // No display string (ROADMAP 6.2): target_word is already in the body, and "the full
  // word was X" is exactly one sentence shape the frontend can build itself from that
  // plus its i18n catalog — no server-side code needed for a single, unvarying outcome.
  return {
    status: 200,
    body: {
      target_word: game.target_word,
      possible_words: possible,
    },
  };
}

export async function rescramble(gameId: string): Promise<Reply> {
  const sql = db();
  const game = await loadGame(sql, gameId);
  if (!game) return NOT_FOUND;

  if (effectiveStatus(game, new Date()) !== "active") {
    return { status: 400, body: { detail: "Game is not active." } };
  }

  const scrambled = scrambleWord(game.target_word);
  await sql`update games set scrambled_letters = ${scrambled} where id = ${game.id}`;

  return {
    status: 200,
    body: { scrambled_letters: scrambled },
  };
}

export async function getState(gameId: string): Promise<Reply> {
  const sql = db();
  const game = await loadGame(sql, gameId);
  if (!game) return NOT_FOUND;

  const status = effectiveStatus(game, new Date());
  return {
    status: 200,
    body: {
      game_id: game.id,
      active: status === "active",
      status,
      scrambled_letters: game.scrambled_letters,
      found_count: game.found_count,
      possible_count: game.possible_count,
      total_score: effectiveScore(game.raw_guess_score, game.hint_cost_total),
      guess_count: game.found_count,
      target_length: game.target_length,
      ends_at: epochSeconds(game.ends_at),
    },
  };
}

/** The full solution list — only once the game is no longer playable (ROADMAP 0.1). */
export async function getPossibleWords(gameId: string): Promise<Reply> {
  const sql = db();
  const game = await loadGame(sql, gameId);
  if (!game) return NOT_FOUND;

  // The frontend fetches this the instant its own countdown hits zero — for most plays
  // this, not getState, is where a stale-active/expired row actually gets finalized.
  const now = new Date();
  const config = await getConfig();
  await finalizeExpiry(sql, game, now, config);

  if (effectiveStatus(game, now) === "active") {
    return {
      status: 403,
      body: { detail: "Possible words are only available after the game ends." },
    };
  }

  const possible = await findableWords(sql, game.wordlist_id, game.target_word, config.min_word_length);
  return { status: 200, body: { possible_words: possible } };
}

export async function getPossibleCount(gameId: string): Promise<Reply> {
  const sql = db();
  const game = await loadGame(sql, gameId);
  if (!game) return NOT_FOUND;
  return { status: 200, body: { possible_count: game.possible_count } };
}

export async function getWordCount(wordlistCode?: string): Promise<Reply> {
  const sql = db();
  const listId = await wordlistId(wordlistCode);
  const [row] = await sql<{ count: number }[]>`
    select count(*)::int as count from words where wordlist_id = ${listId} and active
  `;
  return { status: 200, body: { total_words: row.count } };
}

/** Board lengths worth offering in the start-screen selector (ROADMAP 2.3): within the
 *  playable range and backed by enough candidate targets that a game start won't run dry
 *  or repeat the same handful of words. Scoped per wordlist (ROADMAP 6.1) — a length that
 *  clears the threshold in one language may not in another. */
export async function getAvailableLengths(wordlistCode?: string): Promise<Reply> {
  const sql = db();
  const listId = await wordlistId(wordlistCode);
  const rows = await sql<{ length: number }[]>`
    select length from words
     where wordlist_id = ${listId} and active
       and length between ${MIN_TARGET_LENGTH} and ${MAX_TARGET_LENGTH}
     group by length
    having count(*) >= ${MIN_WORDS_PER_LENGTH}
     order by length
  `;
  return { status: 200, body: { available_lengths: rows.map((row) => row.length) } };
}

/** One cheap DB read, for uptime checks (ROADMAP 1.4) — no Neon keep-alive needed. */
export async function healthCheck(): Promise<Reply> {
  const sql = db();
  await sql`select 1`;
  return { status: 200, body: { ok: true } };
}
