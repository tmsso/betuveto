/**
 * HTTP contract tests — the port of backend/tests/test_api.py (ROADMAP Batch 1.2).
 *
 * These are black-box: they drive a deployed API over HTTP and assert the public
 * contract (no leaked solution, enforced timer, validated input, isolated games). The
 * pytest originals reached into `manager.games[gid].target_word` to build a deterministic
 * guess; nothing reaches into the server here, because there is no in-process state to
 * reach into. Determinism instead comes from the board itself: the scrambled letters are
 * the target's letters, so the same wordlist that was imported tells us locally which
 * words the board can form — and which single word is the target.
 *
 * Point them at any deployment:
 *
 *   API_BASE_URL=https://<preview>.vercel.app npm test
 *
 * With Vercel deployment protection on, also pass the automation bypass secret:
 *
 *   API_BASE_URL=... VERCEL_AUTOMATION_BYPASS_SECRET=... npm test
 *
 * Without API_BASE_URL the suite is skipped, so `npm test` still runs the unit tests
 * anywhere (including CI, which has no database).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  canFormWord,
  durationForLength,
  letterCount,
  normalizeWord,
  signatureOf,
} from "../lib/words.js";

// Not BASE_URL: that is a Vite/Vitest reserved variable (the app's public base path), so
// Vitest would overwrite whatever the shell set with "/".
const BASE_URL = process.env.API_BASE_URL?.replace(/\/$/, "");
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
// Optional: only the negative (401) admin-queue cases run without it, since there's no
// safe way to guess a real token. Pass it when you have it to also check the 200 path.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Skip rather than fail when no deployment is configured: the unit tests still run.
const describeApi = BASE_URL ? describe : describe.skip;

interface StartResult {
  game_id: string;
  scrambled_letters: string;
  target_length: number;
  possible_count: number;
  ends_at: number;
  duration_seconds: number;
}

async function call(
  method: "GET" | "POST" | "PATCH",
  route: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<{ status: number; json: any; headers: Headers }> {
  const headers: Record<string, string> = { ...extraHeaders };
  if (BYPASS) headers["x-vercel-protection-bypass"] = BYPASS;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(`${BASE_URL}${route}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${method} ${route} -> ${response.status}, non-JSON body: ${text.slice(0, 200)}`);
  }
  return { status: response.status, json, headers: response.headers };
}

/** The dictionary as imported, so the tests can reason about a board the way the API does. */
let dictionary: string[] = [];
let bySignature = new Map<string, string[]>();

beforeAll(async () => {
  if (!BASE_URL) return;
  const raw = await readFile(path.join(REPO_ROOT, "data", "magyar-szavak.txt"), "utf-8");
  // De-duplicate exactly as the importer does: the file has repeated lines, and the API's
  // count and solution lists reflect the de-duplicated table, not the raw file.
  const seen = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const word = normalizeWord(line);
    if (!word || seen.has(word)) continue;
    seen.add(word);
    dictionary.push(word);
    const signature = signatureOf(word);
    const bucket = bySignature.get(signature);
    if (bucket) bucket.push(word);
    else bySignature.set(signature, [word]);
  }
});

/** The board's letters, recovered from the space-separated display form. */
function lettersOf(start: StartResult): string {
  return start.scrambled_letters.split(" ").join("");
}

/** Every word this board can spell, computed locally from the same wordlist. */
function findable(start: StartResult): string[] {
  const board = lettersOf(start);
  return dictionary.filter((word) => letterCount(word) <= letterCount(board) && canFormWord(word, board));
}

async function start(targetLength = 7, durationSeconds?: number): Promise<StartResult> {
  const query = new URLSearchParams({ target_length: String(targetLength) });
  if (durationSeconds !== undefined) query.set("duration_seconds", String(durationSeconds));
  const { status, json } = await call("POST", `/api/game/start?${query}`);
  expect(status).toBe(200);
  return json as StartResult;
}

/** Start games until one satisfies `wanted` — the pytest suite's retry trick, for the
 *  cases that need a board with a particular shape. `targetLength` defaults to 7 (the
 *  suite's usual board) but a smaller one finds a small `possible_count` far faster —
 *  a local sample over the wordlist puts the median possible_count at 5 for length-5
 *  boards vs. 19 for length-7. */
async function startUntil(
  wanted: (s: StartResult) => boolean,
  tries = 12,
  targetLength = 7,
): Promise<StartResult> {
  for (let attempt = 0; attempt < tries; attempt++) {
    const game = await start(targetLength);
    if (wanted(game)) return game;
  }
  throw new Error(`No board matching the requirement after ${tries} tries.`);
}

/** Like `start`, but threads (and returns) the anon-identity cookie explicitly — this
 *  Node-side `call` has no browser cookie jar, so a caller that wants continuity across
 *  requests (e.g. to complete a game as one identifiable player) must carry it itself. */
async function startWithCookie(
  targetLength = 7,
  cookie?: string,
): Promise<{ game: StartResult; cookie: string }> {
  const query = new URLSearchParams({ target_length: String(targetLength) });
  const { status, json, headers } = await call(
    "POST",
    `/api/game/start?${query}`,
    undefined,
    cookie ? { Cookie: cookie } : undefined,
  );
  expect(status).toBe(200);
  const setCookie = headers.get("set-cookie");
  const cookieValue = cookie ?? setCookie?.split(";", 1)[0];
  if (!cookieValue) throw new Error("No identity cookie minted or supplied.");
  return { game: json as StartResult, cookie: cookieValue };
}

/** Starts (small, quick-to-clear) boards as the same identity until one is fully
 *  guessable in a handful of requests, then clears it — so the resulting `finished`
 *  game's score is known without depending on any other data in the (shared, persistent)
 *  preview database. */
async function completeSmallGame(): Promise<{ cookie: string; totalScore: number }> {
  let cookie: string | undefined;
  let game: StartResult | undefined;
  for (let attempt = 0; attempt < 20 && !game; attempt++) {
    const result = await startWithCookie(5, cookie);
    cookie = result.cookie;
    if (result.game.possible_count <= 10) game = result.game;
  }
  if (!game || !cookie) throw new Error("No small-enough 5-letter board found after 20 tries.");

  let totalScore = 0;
  for (const word of findable(game)) {
    const { json } = await call("POST", `/api/game/${game.game_id}/guess`, { word }, { Cookie: cookie });
    expect(json.valid).toBe(true);
    totalScore = json.total_score;
    // Spaced out so this sequential loop of legitimate finds doesn't trip the anti-cheat
    // rate limit (ROADMAP 2.2), which counts correct guesses per second.
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  expect(totalScore).toBeGreaterThan(0);
  return { cookie, totalScore };
}

/** A board whose letters spell exactly one full-length word — so that word is provably
 *  the target, without the server ever telling us. */
function hasUniqueTarget(game: StartResult): boolean {
  return (bySignature.get(signatureOf(lettersOf(game))) ?? []).length === 1;
}

function theTarget(game: StartResult): string {
  return bySignature.get(signatureOf(lettersOf(game)))![0];
}

describeApi("Betűvető API contract", () => {
  // --- No solution leaks ---------------------------------------------------
  it("start does not leak the solution", async () => {
    const game = await start();
    expect(game).not.toHaveProperty("target_word");
    expect(game).not.toHaveProperty("current_word");
    expect(game).not.toHaveProperty("possible_words");
    expect(game.possible_count).toBeGreaterThanOrEqual(1);
    expect(game).toHaveProperty("ends_at");
    expect(game).toHaveProperty("game_id");
  });

  it("state does not leak the solution", async () => {
    const game = await start();
    const { json } = await call("GET", `/api/game/${game.game_id}`);
    expect(json).not.toHaveProperty("target_word");
    expect(json).not.toHaveProperty("current_word");
  });

  it("blocks the possible-words list while the game is active", async () => {
    const game = await start();
    const { status } = await call("GET", `/api/game/${game.game_id}/possible_words`);
    expect(status).toBe(403);
  });

  it("exposes the possible-words count while active", async () => {
    const game = await start();
    const { json } = await call("GET", `/api/game/${game.game_id}/possible_words/count`);
    expect(json.possible_count).toBe(game.possible_count);
  });

  // --- Scoring & guessing --------------------------------------------------
  it("scores the target word and flags it", async () => {
    const game = await startUntil(hasUniqueTarget);
    const target = theTarget(game);

    const { json } = await call("POST", `/api/game/${game.game_id}/guess`, { word: target });
    expect(json.valid).toBe(true);
    expect(json.can_form).toBe(true);
    expect(json.already_guessed).toBe(false);
    expect(json.score).toBe(letterCount(target) ** 2);
    expect(json.is_target).toBe(true);
    expect(json.is_full_length).toBe(true);
  });

  it("scores a duplicate guess zero", async () => {
    const game = await startUntil((g) => g.possible_count >= 2);
    const word = findable(game).sort()[0];

    const first = await call("POST", `/api/game/${game.game_id}/guess`, { word });
    expect(first.json.score).toBe(letterCount(word) ** 2);

    const second = await call("POST", `/api/game/${game.game_id}/guess`, { word });
    expect(second.json.already_guessed).toBe(true);
    expect(second.json.score).toBe(0);
  });

  it("rejects a word that is not in the dictionary", async () => {
    const game = await start();
    const { json } = await call("POST", `/api/game/${game.game_id}/guess`, { word: "QWXZQWX" });
    expect(json.valid).toBe(false);
    expect(json.can_form).toBe(false);
  });

  it("rejects a real word the board cannot spell", async () => {
    const game = await start();
    // A dictionary word made of letters the board does not have.
    const board = lettersOf(game);
    const impossible = dictionary.find((word) => !canFormWord(word, board));
    const { json } = await call("POST", `/api/game/${game.game_id}/guess`, { word: impossible });
    expect(json.valid).toBe(true);
    expect(json.can_form).toBe(false);
    expect(json.score).toBe(0);
  });

  it("enforces the minimum word length", async () => {
    const game = await start();
    const { json } = await call("POST", `/api/game/${game.game_id}/guess`, { word: "AB" });
    expect(json.valid).toBe(false);
    expect(json.message).toContain("Legalább");
  });

  // --- Input validation & unknown games ------------------------------------
  it("rejects an out-of-range target length", async () => {
    expect((await call("POST", "/api/game/start?target_length=4")).status).toBe(422);
    expect((await call("POST", "/api/game/start?target_length=11")).status).toBe(422);
  });

  it("returns 404 for an unknown game id", async () => {
    const gone = "00000000-0000-4000-8000-000000000000";
    expect((await call("POST", `/api/game/${gone}/guess`, { word: "ALMA" })).status).toBe(404);
    expect((await call("GET", `/api/game/${gone}`)).status).toBe(404);
    expect((await call("GET", `/api/game/${gone}/possible_words`)).status).toBe(404);
    expect((await call("POST", `/api/game/${gone}/rescramble`)).status).toBe(404);
  });

  it("returns 404 for a malformed game id rather than a server error", async () => {
    expect((await call("GET", "/api/game/nope")).status).toBe(404);
  });

  // --- Server-enforced timer -----------------------------------------------
  it("rejects guesses once the timer has expired", async () => {
    // The server clamps duration to >= 5s and never lets a client lengthen it, so this
    // shortens the clock rather than faking one.
    const game = await start(7, 5);
    const word = findable(game).sort()[0];

    await new Promise((resolve) => setTimeout(resolve, 7000));

    const { json } = await call("POST", `/api/game/${game.game_id}/guess`, { word });
    expect(json.game_ended).toBe(true);
    expect(json.score).toBe(0);

    // The full solution list is available once the game is over.
    const solution = await call("GET", `/api/game/${game.game_id}/possible_words`);
    expect(solution.status).toBe(200);
  }, 30_000);

  // --- Full board clear + completion bonus (ROADMAP 3.2) --------------------
  it("awards a server-computed time-remaining bonus for fully clearing the board", async () => {
    // A length-5 board keeps the guess loop short (median possible_count is 5, see the
    // comment on startUntil), and the default 180s duration leaves plenty of clock left,
    // so the bonus should always land nonzero.
    const game = await startUntil((g) => g.possible_count >= 1 && g.possible_count <= 6, 15, 5);
    const words = findable(game);
    expect(words).toHaveLength(game.possible_count);

    let last: { json: any } | undefined;
    let scoreWithoutBonus = 0;
    for (const word of words) {
      last = await call("POST", `/api/game/${game.game_id}/guess`, { word });
      expect(last.json.valid).toBe(true);
      expect(last.json.can_form).toBe(true);
      expect(last.json.already_guessed).toBe(false);
      scoreWithoutBonus += letterCount(word) ** 2;
      // Spaced out so this sequential loop of legitimate finds doesn't trip the anti-cheat
      // rate limit (ROADMAP 2.2), which counts correct guesses per second.
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    // The last guess clears the board: the server ends the game itself and folds a
    // remaining_seconds * completion_multiplier bonus into total_score.
    expect(last!.json.game_ended).toBe(true);
    expect(last!.json.completion_bonus).toBeGreaterThan(0);
    expect(last!.json.total_score).toBe(scoreWithoutBonus + last!.json.completion_bonus);

    // The game is over: no further scoring, and the board's earlier guesses
    // reported the running total, not yet the bonus.
    const late = await call("POST", `/api/game/${game.game_id}/guess`, { word: words[0] });
    expect(late.status).toBe(400);
    // Up to 15 sequential start() retries against a possibly-cold preview, plus the
    // guess loop — generous headroom over the happy-path (typically 1-2 retries).
  }, 60_000);

  // --- Give up --------------------------------------------------------------
  it("give up reveals the word and unlocks the solution list", async () => {
    const game = await startUntil(hasUniqueTarget);
    const target = theTarget(game);

    const { json } = await call("POST", `/api/game/${game.game_id}/give_up`);
    expect(json.target_word).toBe(target);
    expect(json.possible_words).toContain(target);

    expect((await call("GET", `/api/game/${game.game_id}/possible_words`)).status).toBe(200);

    // No further scoring once the game is over.
    const late = await call("POST", `/api/game/${game.game_id}/guess`, { word: target });
    expect(late.status).toBe(400);
  });

  it("the revealed solution list matches what the board can actually form", async () => {
    const game = await start();
    const { json } = await call("POST", `/api/game/${game.game_id}/give_up`);
    expect(json.possible_words.sort()).toEqual(findable(game).sort());
    expect(json.possible_words).toHaveLength(game.possible_count);
  });

  // --- Two players do not clobber each other -------------------------------
  it("keeps concurrent games isolated", async () => {
    const a = await startUntil(hasUniqueTarget);
    const b = await start();
    expect(a.game_id).not.toBe(b.game_id);

    await call("POST", `/api/game/${a.game_id}/guess`, { word: theTarget(a) });

    const { json } = await call("GET", `/api/game/${b.game_id}`);
    expect(json.found_count).toBe(0);
  });

  // --- State survives a redeploy (no in-process state) ----------------------
  it("serves game state from the database, not from memory", async () => {
    const game = await startUntil((g) => g.possible_count >= 2);
    const word = findable(game).sort()[0];
    await call("POST", `/api/game/${game.game_id}/guess`, { word });

    // A fresh request may land on any function instance; the score must still be there.
    const { json } = await call("GET", `/api/game/${game.game_id}`);
    expect(json.found_count).toBe(1);
    expect(json.total_score).toBe(letterCount(word) ** 2);
    expect(json.active).toBe(true);
  });

  // --- Rescramble ------------------------------------------------------------
  it("rescramble keeps the same letters and persists them", async () => {
    const game = await start();
    const { json } = await call("POST", `/api/game/${game.game_id}/rescramble`);
    expect(signatureOf(json.scrambled_letters.split(" ").join(""))).toBe(
      signatureOf(lettersOf(game)),
    );

    const state = await call("GET", `/api/game/${game.game_id}`);
    expect(state.json.scrambled_letters).toBe(json.scrambled_letters);
  });

  // --- Word endpoints --------------------------------------------------------
  it("reports the imported dictionary", async () => {
    const { json } = await call("GET", "/api/words/count");
    expect(json.total_words).toBe(dictionary.length);

    const lengths = await call("GET", "/api/words/lengths");
    expect(lengths.json.available_lengths).toContain(7);
  });

  // --- Word length option (ROADMAP 2.3) --------------------------------------
  it("only offers board lengths in the playable 5-10 range (ROADMAP 2.3)", async () => {
    const { json } = await call("GET", "/api/words/lengths");
    for (const length of json.available_lengths) {
      expect(length).toBeGreaterThanOrEqual(5);
      expect(length).toBeLessThanOrEqual(10);
    }
    // The Hungarian list has thousands of words at every length in range (verified
    // directly against the DB), so all six should clear the >= 500 bar.
    expect(json.available_lengths).toEqual([5, 6, 7, 8, 9, 10]);
  });

  it("scales the timer with target length (ROADMAP 2.3: 120 + 15 * (length - 5))", async () => {
    const short = await start(5);
    const long = await start(10);
    expect(short.duration_seconds).toBe(durationForLength(5));
    expect(long.duration_seconds).toBe(durationForLength(10));
    expect(long.duration_seconds).toBeGreaterThan(short.duration_seconds);
  });

  it("still lets a client shorten (never lengthen) its own timer per length", async () => {
    const game = await start(10, 5);
    expect(game.duration_seconds).toBe(5);
  });

  // --- Preferred length persistence (ROADMAP 2.3) ----------------------------
  it("round-trips a player's preferred length through PATCH/GET (ROADMAP 2.3)", async () => {
    // A fresh cookie, minted the same way game/start does it.
    const minted = await call("POST", "/api/game/start?target_length=7");
    const cookieValue = minted.headers.get("set-cookie")!.split(";", 1)[0];
    const auth = { Cookie: cookieValue };

    const before = await call("GET", "/api/v1/me/preferences", undefined, auth);
    expect(before.json.preferred_length).toBeNull();

    const patched = await call(
      "PATCH",
      "/api/v1/me/preferences",
      { preferred_length: 9 },
      auth,
    );
    expect(patched.status).toBe(200);
    expect(patched.json.preferred_length).toBe(9);

    const after = await call("GET", "/api/v1/me/preferences", undefined, auth);
    expect(after.json.preferred_length).toBe(9);
  });

  it("rejects an out-of-range preferred length", async () => {
    const minted = await call("POST", "/api/game/start?target_length=7");
    const cookieValue = minted.headers.get("set-cookie")!.split(";", 1)[0];
    const { status } = await call(
      "PATCH",
      "/api/v1/me/preferences",
      { preferred_length: 4 },
      { Cookie: cookieValue },
    );
    expect(status).toBe(422);
  });

  it("treats writing a preference with no identity as unauthorized, reading as null", async () => {
    const get = await call("GET", "/api/v1/me/preferences");
    expect(get.status).toBe(200);
    expect(get.json.preferred_length).toBeNull();

    const patch = await call("PATCH", "/api/v1/me/preferences", { preferred_length: 6 });
    expect(patch.status).toBe(401);
  });

  it("health route confirms a live DB connection (ROADMAP 1.4)", async () => {
    const { status, json } = await call("GET", "/api/v1/health");
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
  });

  // --- Anonymous identity (ROADMAP 2.1) --------------------------------------
  it("mints a signed anonymous cookie on first visit and remembers it thereafter", async () => {
    const first = await call("POST", "/api/game/start?target_length=7");
    const mintedCookie = first.headers.get("set-cookie");
    expect(mintedCookie).toBeTruthy();
    expect(mintedCookie).toMatch(/^bv_anon=[^;]+\.[0-9a-f]+;/);
    expect(typeof first.json.player_id).toBe("string");

    // Send only the cookie's own name=value back, as a browser would.
    const cookieValue = mintedCookie!.split(";", 1)[0];
    const second = await call("POST", "/api/game/start?target_length=7", undefined, {
      Cookie: cookieValue,
    });
    expect(second.json.player_id).toBe(first.json.player_id);
    // Same identity recognised: no need to mint (and overwrite) the cookie again.
    expect(second.headers.get("set-cookie")).toBeNull();
  });

  // --- Server-side high scores (ROADMAP 2.2) ---------------------------------
  it("rejects an out-of-range length and an unknown period", async () => {
    expect((await call("GET", "/api/v1/scores/top?length=4")).status).toBe(422);
    expect((await call("GET", "/api/v1/scores/top?length=7&period=month")).status).toBe(422);
  });

  it("lists top scores ordered best-first", async () => {
    const { status, json } = await call("GET", "/api/v1/scores/top?length=7");
    expect(status).toBe(200);
    expect(Array.isArray(json.top)).toBe(true);
    for (let i = 1; i < json.top.length; i++) {
      expect(json.top[i - 1].final_score).toBeGreaterThanOrEqual(json.top[i].final_score);
    }
  });

  it("reports your_best: null with no identity cookie", async () => {
    const { json } = await call("GET", "/api/v1/scores/top?length=7");
    expect(json.your_best).toBeNull();
  });

  it("a fully-cleared game's score shows up as your_best on /api/v1/scores/top", async () => {
    // Anchored on your_best rather than top-10 membership: the preview DB is a shared,
    // persistent Neon instance, so a fresh score could rank outside the top 10 (or drop
    // out of it later) without this test being wrong — your_best is this player's alone.
    const { cookie, totalScore } = await completeSmallGame();

    const { status, json } = await call("GET", "/api/v1/scores/top?length=5", undefined, {
      Cookie: cookie,
    });
    expect(status).toBe(200);
    expect(json.your_best).not.toBeNull();
    expect(json.your_best.final_score).toBe(totalScore);
  }, 30_000);

  // --- Hints (ROADMAP 3.1) ----------------------------------------------------
  it("reveals a letter and deducts its cost, floored at 0", async () => {
    const game = await startUntil((g) => g.possible_count >= 2, 15, 5);
    const { status, json } = await call("POST", `/api/game/${game.game_id}/hint`);
    expect(status).toBe(200);
    expect(typeof json.letter).toBe("string");
    expect(json.letter).toHaveLength(1);
    expect(json.position).toBe(1);
    expect(json.cost).toBeGreaterThan(0);
    // No guesses scored yet, so the raw score is 0 — floored at 0 regardless of cost.
    expect(json.total_score).toBe(0);
  });

  it("deducts the hint cost from a following guess's score, floored at 0", async () => {
    const game = await startUntil((g) => g.possible_count >= 2, 15, 5);
    const hint = await call("POST", `/api/game/${game.game_id}/hint`);
    expect(hint.status).toBe(200);

    const word = findable(game).sort()[0];
    const { json } = await call("POST", `/api/game/${game.game_id}/guess`, { word });
    expect(json.total_score).toBe(Math.max(0, letterCount(word) ** 2 - hint.json.cost));
  });

  it("rejects a hint once the game has ended", async () => {
    const game = await start();
    await call("POST", `/api/game/${game.game_id}/give_up`);
    const { status } = await call("POST", `/api/game/${game.game_id}/hint`);
    expect(status).toBe(400);
  });

  it("rejects a hint once every word is already found", async () => {
    const game = await startUntil((g) => g.possible_count >= 1 && g.possible_count <= 6, 15, 5);
    for (const word of findable(game)) {
      await call("POST", `/api/game/${game.game_id}/guess`, { word });
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    const { status } = await call("POST", `/api/game/${game.game_id}/hint`);
    expect(status).toBe(400);
  }, 30_000);

  // --- Player stats (ROADMAP 3.3) ---------------------------------------------
  it("me/stats reads as an empty sheet with no identity", async () => {
    const { json } = await call("GET", "/api/v1/me/stats");
    expect(json.games_played).toBe(0);
    expect(json.completion_rate).toBe(0);
    expect(json.failed_words).toEqual([]);
    expect(json.longest_word_found).toBeNull();
  });

  it("records a given-up target as a failed word, visible on me/stats", async () => {
    const { game, cookie } = await startWithCookie();
    const giveUp = await call("POST", `/api/game/${game.game_id}/give_up`, undefined, {
      Cookie: cookie,
    });
    expect(giveUp.status).toBe(200);

    const { json } = await call("GET", "/api/v1/me/stats", undefined, { Cookie: cookie });
    expect(json.games_played).toBeGreaterThanOrEqual(1);
    const entry = json.failed_words.find((f: { word: string }) => f.word === giveUp.json.target_word);
    expect(entry).toBeTruthy();
    expect(entry.times_failed).toBeGreaterThanOrEqual(1);
  });

  // --- Word curation (ROADMAP 4.1) --------------------------------------------
  //
  // Deliberately narrow: only the read-only, no-side-effect paths (no identity, unknown
  // word) are exercised here. This suite is meant to be safe to run repeatedly against
  // any deployment indefinitely, including a shared, persistent production database
  // (ROADMAP 1.5 — Production and Preview share one Neon connection by default). A first
  // draft of this test also asserted the insert/idempotency path with a real dictionary
  // word — every run mints a fresh player_id, so *separate runs* reporting the same word
  // is exactly two distinct reporters, which auto-inactivates it (>= 2 distinct players,
  // lib/word-reports.ts). `findable(game)[0]` is also biased toward short, common words
  // (first match in wordlist-file order), making a collision across runs likely rather
  // than remote. Caught before merge by checking the actual DB rather than assuming a
  // single manual test run proved it safe. The accept-and-record path is covered by
  // manual verification instead (curl + direct DB queries), not by this committed suite.
  it("requires identity to report a word, and 404s an unknown word", async () => {
    const game = await start();
    const word = findable(game)[0];

    const unauth = await call("POST", "/api/v1/words/report", { word });
    expect(unauth.status).toBe(401);

    const { cookie } = await startWithCookie();
    const unknown = await call(
      "POST",
      "/api/v1/words/report",
      { word: "NEMLETEZOSZOXYZ" },
      { Cookie: cookie },
    );
    expect(unknown.status).toBe(404);
  });

  // --- Batch 4.2: suggest a missing word --------------------------------------
  it("requires identity and validates a suggested word", async () => {
    const { cookie } = await startWithCookie();

    const unauth = await call("POST", "/api/v1/words/suggest", { word: "PELDASZO" });
    expect(unauth.status).toBe(401);

    const tooShort = await call("POST", "/api/v1/words/suggest", { word: "AB" }, { Cookie: cookie });
    expect(tooShort.status).toBe(422);

    // Q/W/X/Y are excluded from the standard Hungarian alphabet this feature curates for.
    const foreignLetters = await call(
      "POST",
      "/api/v1/words/suggest",
      { word: "WXYTESZT" },
      { Cookie: cookie },
    );
    expect(foreignLetters.status).toBe(422);
  });

  it("flags an already-known word, accepts a genuinely new one, and is idempotent on repeat", async () => {
    const { cookie } = await startWithCookie();
    const hungarianAlphabet = /^[ABCDEFGHIJKLMNOPRSTUVZÁÉÍÓÖŐÚÜŰ]+$/;
    const known = dictionary.find((word) => hungarianAlphabet.test(word));
    expect(known).toBeDefined();

    const existing = await call("POST", "/api/v1/words/suggest", { word: known }, { Cookie: cookie });
    expect(existing.status).toBe(200);
    expect(existing.json.already_present).toBe(true);

    const alphabet = "BDFGKLMNPRST";
    let novel = "";
    do {
      novel = Array.from({ length: 9 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join(
        "",
      );
    } while (dictionary.includes(novel));

    const first = await call("POST", "/api/v1/words/suggest", { word: novel }, { Cookie: cookie });
    expect(first.status).toBe(200);
    expect(first.json.already_present).toBe(false);

    const second = await call("POST", "/api/v1/words/suggest", { word: novel }, { Cookie: cookie });
    expect(second.status).toBe(200);
    expect(second.json.already_present).toBe(true);
  });

  // --- Batch 5.1: admin review queue -----------------------------------------
  it("gates the admin review queue behind the admin token", async () => {
    const noToken = await call("GET", "/api/v1/admin/queue");
    expect(noToken.status).toBe(401);

    const wrongToken = await call("GET", "/api/v1/admin/queue", undefined, {
      "x-admin-token": "definitely-not-the-real-token",
    });
    expect(wrongToken.status).toBe(401);

    if (!ADMIN_TOKEN) return; // no safe way to test the success path without the real secret

    const ok = await call("GET", "/api/v1/admin/queue", undefined, { "x-admin-token": ADMIN_TOKEN });
    expect(ok.status).toBe(200);
    expect(Array.isArray(ok.json.reports)).toBe(true);
    expect(Array.isArray(ok.json.suggestions)).toBe(true);
  });

  // --- Anti-cheat rate limit correctness under concurrency (ROADMAP 2.2) ------
  it("bounds truly concurrent correct guesses and keeps found_count consistent", async () => {
    // A board with several findable words fired in one burst — true concurrency, not a
    // sequential loop, is what a check-then-act rate limit can fail to catch.
    const game = await startUntil((g) => g.possible_count >= 5, 15, 7);
    const words = findable(game).slice(0, 5);

    const results = await Promise.all(
      words.map((word) => call("POST", `/api/game/${game.game_id}/guess`, { word })),
    );

    const succeeded = results.filter(
      (r) => r.status === 200 && r.json.valid && r.json.can_form && !r.json.already_guessed,
    );
    const limited = results.filter((r) => r.status === 429);
    expect(limited.length).toBeGreaterThan(0);
    expect(succeeded.length).toBeLessThan(words.length);

    // found_count must equal the number of distinct guesses that actually scored — a
    // stale-read race would have let concurrent guesses overwrite each other's increment.
    const state = await call("GET", `/api/game/${game.game_id}`);
    expect(state.json.found_count).toBe(succeeded.length);
  });
});
