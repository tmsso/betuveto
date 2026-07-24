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
import { canFormWord, letterCount, normalizeWord, signatureOf } from "../lib/words.js";

// Not BASE_URL: that is a Vite/Vitest reserved variable (the app's public base path), so
// Vitest would overwrite whatever the shell set with "/".
const BASE_URL = process.env.API_BASE_URL?.replace(/\/$/, "");
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Skip rather than fail when no deployment is configured: the unit tests still run.
const describeApi = BASE_URL ? describe : describe.skip;

interface StartResult {
  game_id: string;
  scrambled_letters: string;
  target_length: number;
  possible_count: number;
  ends_at: number;
}

async function call(
  method: "GET" | "POST",
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
});
