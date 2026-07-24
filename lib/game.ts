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
import { db, wordlistId } from "./db.js";
import {
  GAME_DURATION_SECONDS,
  MAX_TARGET_LENGTH,
  MIN_TARGET_LENGTH,
  MIN_WORD_LENGTH,
  canFormWord,
  letterCount,
  normalizeGuess,
  scoreFor,
  scrambleWord,
  signatureOf,
  subSignatures,
} from "./words.js";

export interface Reply {
  status: number;
  body: unknown;
  /** Set-Cookie etc. — currently only game/start's freshly-minted anon identity uses this. */
  headers?: Record<string, string>;
}

interface GameRow {
  id: string;
  wordlist_id: number;
  target_word: string;
  target_length: number;
  scrambled_letters: string;
  possible_count: number;
  found_count: number;
  status: string;
  ends_at: Date;
  total_score: number;
}

const NOT_FOUND: Reply = {
  status: 404,
  body: { detail: "Game not found or expired. Start a new game." },
};

/** Points per second left on the clock when a board is fully cleared (ROADMAP 3.2). A
 *  plain constant for now — becomes admin-editable config in Batch 5. */
const COMPLETION_BONUS_MULTIPLIER = 1;

/** Seconds since the epoch, as the frontend's countdown expects (it compares to Date.now()/1000). */
function epochSeconds(at: Date): number {
  return at.getTime() / 1000;
}

async function loadGame(sql: Sql, gameId: string): Promise<GameRow | null> {
  // A malformed id must read as "no such game", not as a 500 from Postgres' uuid parser.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(gameId)) {
    return null;
  }
  const [game] = await sql<GameRow[]>`
    select g.id, g.wordlist_id, g.target_word, g.target_length, g.scrambled_letters,
           g.possible_count, g.found_count, g.status, g.ends_at,
           coalesce((select sum(score)::int from game_guesses
                      where game_id = g.id and correct), 0) as total_score
      from games g
     where g.id = ${gameId}
  `;
  return game ?? null;
}

/** The effective status: an active game whose deadline has passed is expired, whether or
 *  not anything has written that to the row yet. */
function effectiveStatus(game: GameRow, now: Date): string {
  if (game.status === "active" && now > game.ends_at) return "expired";
  return game.status;
}

/** The words findable on this board: those whose signature is a sub-multiset of the
 *  board's letters. One indexed lookup, ~99 signatures for a 7-letter board. */
async function findableWords(sql: Sql, listId: number, target: string): Promise<string[]> {
  const signatures = subSignatures(signatureOf(target), MIN_WORD_LENGTH);
  const rows = await sql<{ word: string }[]>`
    select word from words
     where wordlist_id = ${listId} and active and signature = any(${signatures})
     order by word
  `;
  return rows.map((row) => row.word);
}

export async function startGame(
  targetLength: number,
  durationSeconds: number | undefined,
  playerId: string,
  // Only set when the caller minted a fresh identity this request — signals both "create
  // the players row" and "echo the Set-Cookie back", so the two can never drift apart.
  setCookieHeader?: string,
): Promise<Reply> {
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

  // Clamped so a client can shorten its own timer (which the tests use to exercise
  // expiry) but never lengthen it. A shorter clock is only ever a handicap, so this
  // cannot be turned into an advantage.
  const duration =
    durationSeconds === undefined
      ? GAME_DURATION_SECONDS
      : Math.min(Math.max(durationSeconds, 5), GAME_DURATION_SECONDS);

  const sql = db();
  const listId = await wordlistId();

  if (setCookieHeader) {
    // Explicit id: the column default (gen_random_uuid()) exists for callers that don't
    // care which id they get, but this one must match the cookie already being minted.
    await sql`insert into players (id) values (${playerId})`;
  }

  // Uniform among active words of the requested length. The per-player weighting that
  // resurfaces previously-failed words (word_stats) needs an identity to key on, which
  // arrives with auth in Batch 2; anonymous games have no history to weight by.
  const [pick] = await sql<{ word: string }[]>`
    select word from words
     where wordlist_id = ${listId} and length = ${targetLength} and active
     order by random()
     limit 1
  `;
  if (!pick) {
    return { status: 404, body: { detail: `No words found with length ${targetLength}` } };
  }

  const target = pick.word;
  const possible = await findableWords(sql, listId, target);
  const scrambled = scrambleWord(target);

  const [game] = await sql<{ id: string; ends_at: Date }[]>`
    insert into games (player_id, wordlist_id, target_word, target_length, scrambled_letters,
                       possible_count, ends_at)
    values (${playerId}, ${listId}, ${target}, ${targetLength}, ${scrambled},
            ${possible.length}, now() + ${`${duration} seconds`}::interval)
    returning id, ends_at
  `;

  return {
    status: 200,
    body: {
      game_id: game.id,
      scrambled_letters: scrambled,
      target_length: targetLength,
      game_active: true,
      ends_at: epochSeconds(game.ends_at),
      duration_seconds: duration,
      possible_count: possible.length,
      is_previously_failed: false,
      // Not the auth token itself (that stays HttpOnly) — just the id, so a black-box
      // test (or a future /me endpoint) can assert continuity across requests.
      player_id: playerId,
    },
    ...(setCookieHeader ? { headers: { "Set-Cookie": setCookieHeader } } : {}),
  };
}

export async function guess(gameId: string, rawWord: string): Promise<Reply> {
  const sql = db();
  const game = await loadGame(sql, gameId);
  if (!game) return NOT_FOUND;

  const now = new Date();
  const status = effectiveStatus(game, now);

  if (status === "expired") {
    // Persist the expiry the first time anyone notices it.
    if (game.status === "active") {
      await sql`
        update games set status = 'expired', ended_at = now(), final_score = ${game.total_score}
         where id = ${game.id} and status = 'active'
      `;
    }
    return {
      status: 200,
      body: {
        valid: false,
        can_form: false,
        already_guessed: false,
        score: 0,
        message: "Lejárt az idő.",
        game_ended: true,
        total_score: game.total_score,
        found_count: game.found_count,
      },
    };
  }

  if (status !== "active") {
    return { status: 400, body: { detail: "Game is not active. Start a new game." } };
  }

  const word = normalizeGuess(rawWord);
  // `valid` = "this is a real word"; `can_form` = "and this board can spell it".
  const reject = (message: string, valid = false): Reply => ({
    status: 200,
    body: {
      valid,
      can_form: false,
      already_guessed: false,
      score: 0,
      message,
      game_ended: false,
    },
  });

  if (letterCount(word) < MIN_WORD_LENGTH) {
    return reject(`Legalább ${MIN_WORD_LENGTH} betűs szót adj meg.`);
  }

  const [known] = await sql<{ word: string }[]>`
    select word from words
     where wordlist_id = ${game.wordlist_id} and word = ${word} and active
  `;
  if (!known) return reject(`Nem ismerek ilyen szót: ${word}`);

  if (!canFormWord(word, game.target_word)) {
    // A real word, just not one this board can spell: valid, but not formable.
    return reject(`Ezekből a betűkből nem rakható ki: ${word}`, true);
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
        message: `Ezért a szóért már kaptál pontot. Pontszámod továbbra is ${game.total_score}.`,
        game_ended: false,
      },
    };
  }

  const totalScore = game.total_score + score;
  const foundCount = game.found_count + 1;
  const gameEnded = foundCount >= game.possible_count;
  // Floored at 0: the game could theoretically end in the same instant as its last second.
  const remainingSeconds = Math.max(0, Math.floor((game.ends_at.getTime() - now.getTime()) / 1000));
  const completionBonus = gameEnded ? remainingSeconds * COMPLETION_BONUS_MULTIPLIER : 0;
  const finalScore = totalScore + completionBonus;

  await sql`
    update games
       set found_count = ${foundCount},
           status      = case when ${gameEnded} then 'finished' else status end,
           ended_at    = case when ${gameEnded} then now() else ended_at end,
           final_score = case when ${gameEnded} then ${finalScore} else final_score end
     where id = ${game.id}
  `;

  return {
    status: 200,
    body: {
      valid: true,
      can_form: true,
      already_guessed: false,
      score,
      message: `Helyes! ${score} pont, összesen eddig ${totalScore}.`,
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

  if (game.status === "active") {
    await sql`
      update games
         set status = 'given_up', ended_at = now(), final_score = ${game.total_score}
       where id = ${game.id} and status = 'active'
    `;
  }

  const possible = await findableWords(sql, game.wordlist_id, game.target_word);
  return {
    status: 200,
    body: {
      target_word: game.target_word,
      possible_words: possible,
      message: `A teljes szó: ${game.target_word}`,
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
    body: { scrambled_letters: scrambled, message: "Betűk újrakeverve!" },
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
      total_score: game.total_score,
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

  if (effectiveStatus(game, new Date()) === "active") {
    return {
      status: 403,
      body: { detail: "Possible words are only available after the game ends." },
    };
  }

  const possible = await findableWords(sql, game.wordlist_id, game.target_word);
  return { status: 200, body: { possible_words: possible } };
}

export async function getPossibleCount(gameId: string): Promise<Reply> {
  const sql = db();
  const game = await loadGame(sql, gameId);
  if (!game) return NOT_FOUND;
  return { status: 200, body: { possible_count: game.possible_count } };
}

export async function getWordCount(): Promise<Reply> {
  const sql = db();
  const listId = await wordlistId();
  const [row] = await sql<{ count: number }[]>`
    select count(*)::int as count from words where wordlist_id = ${listId} and active
  `;
  return { status: 200, body: { total_words: row.count } };
}

export async function getAvailableLengths(): Promise<Reply> {
  const sql = db();
  const listId = await wordlistId();
  const rows = await sql<{ length: number }[]>`
    select distinct length from words
     where wordlist_id = ${listId} and active
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
