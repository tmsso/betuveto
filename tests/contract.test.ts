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
import { ACHIEVEMENT_KEYS } from "../lib/achievements.js";

// Not BASE_URL: that is a Vite/Vitest reserved variable (the app's public base path), so
// Vitest would overwrite whatever the shell set with "/".
const BASE_URL = process.env.API_BASE_URL?.replace(/\/$/, "");
const BYPASS = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
// Optional: only the negative (401) admin-queue cases run without it, since there's no
// safe way to guess a real token. Pass it when you have it to also check the 200 path.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

// ROADMAP Batch 10 item 11 (contract-suite half). `start()` below mints a brand-new
// anonymous player on every call, and `startUntil` calls it in a retry loop — so one
// run of this suite against production used to add 100+ single-game players to the admin
// dashboard's games/day and DAU (the E2E smoke test's own noise was already fixed in
// item 11; this is the other, larger source). When CONTRACT_CI_PLAYER_COOKIE is set — a
// pre-signed `bv_anon` value (the `<uuid>.<hmac>` part only, no `bv_anon=` prefix) for a
// player row manually flagged `is_ci = true` in production, same bootstrap as the E2E
// suite's E2E_CI_PLAYER_COOKIE — every shape-probing `start()` reuses that one identity
// and the dashboard excludes it.
//
// Deliberately NOT applied to `startWithCookie` / `startWithCookieEn`, `completeSmallGame`
// / `completeSmallGameEn`, `startDashboardVisibleGame`, or the direct-`call` mint sites:
// each of those backs a test that asserts on *fresh-player* state — `your_best.final_score`
// must equal exactly this run's score for the hu/en cross-contamination test; "mints a
// signed cookie on first visit" checks the mint itself; the dashboard tests assert a game
// played today is *visible* in games/day, which an is_ci player is excluded from by
// design. A fresh identity is the correct fixture there, not a compromise — leaving a
// bounded ~15 minted players per full run, down from 100+. Do not "resolve" that residue
// by weakening those assertions; it is already resolved.
//
// Caveat: the pinned identity accumulates `word_stats` over time, and
// `pickPersonalizedWord()` (lib/game.ts) prefers never-seen targets, so
// `startUntil(hasUniqueTarget)`'s candidate pool narrows run over run. If it starts
// needing more retries, raise the `tries` arguments rather than un-pinning.
const CONTRACT_CI_COOKIE = process.env.CONTRACT_CI_PLAYER_COOKIE;
const PINNED_COOKIE_HEADER: Record<string, string> | undefined = CONTRACT_CI_COOKIE
  ? { Cookie: `bv_anon=${CONTRACT_CI_COOKIE}` }
  : undefined;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Skip rather than fail when no deployment is configured: the unit tests still run.
const describeApi = BASE_URL ? describe : describe.skip;

// The canonical production alias. A test that has to mutate a *visible* setting (e.g.
// hiding the length selector for the forcing check below) skips against production —
// preview deployments have their own isolated Neon DB and no real players.
const IS_PRODUCTION = BASE_URL === "https://betuveto.vercel.app";

interface StartResult {
  game_id: string;
  scrambled_letters: string;
  target_length: number;
  possible_count: number;
  ends_at: number;
  duration_seconds: number;
  difficulty: "easy" | "normal";
}

async function call(
  method: "GET" | "POST" | "PATCH" | "DELETE",
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
// English (ROADMAP 6.1) — loaded the same way, for the wordlist-scoping tests below.
let enDictionary: string[] = [];
let enBySignature = new Map<string, string[]>();

function loadDictionary(raw: string): { words: string[]; bySignature: Map<string, string[]> } {
  // De-duplicate exactly as the importer does: the file has repeated lines, and the API's
  // count and solution lists reflect the de-duplicated table, not the raw file.
  const seen = new Set<string>();
  const words: string[] = [];
  const bySig = new Map<string, string[]>();
  for (const line of raw.split(/\r?\n/)) {
    const word = normalizeWord(line);
    if (!word || seen.has(word)) continue;
    seen.add(word);
    words.push(word);
    const signature = signatureOf(word);
    const bucket = bySig.get(signature);
    if (bucket) bucket.push(word);
    else bySig.set(signature, [word]);
  }
  return { words, bySignature: bySig };
}

beforeAll(async () => {
  if (!BASE_URL) return;
  const hu = loadDictionary(
    await readFile(path.join(REPO_ROOT, "data", "magyar-szavak.txt"), "utf-8"),
  );
  dictionary = hu.words;
  bySignature = hu.bySignature;

  const en = loadDictionary(
    await readFile(path.join(REPO_ROOT, "data", "english-words.txt"), "utf-8"),
  );
  enDictionary = en.words;
  enBySignature = en.bySignature;
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
  // PINNED_COOKIE_HEADER is undefined unless CONTRACT_CI_PLAYER_COOKIE is set — see the
  // long note near the top. When set, every board this suite probes is attributed to the
  // one pinned is_ci player instead of a fresh one per call.
  const { status, json } = await call("POST", `/api/game/start?${query}`, undefined, PINNED_COOKIE_HEADER);
  expect(status).toBe(200);
  return json as StartResult;
}

/** A game deliberately attributed to a brand-new anonymous player, never the pinned
 *  CONTRACT_CI_PLAYER_COOKIE identity — for the dashboard tests below, whose assertion is
 *  "a game played today is visible in games/day and DAU", which a pinned `is_ci` player is
 *  excluded from by design (lib/admin-dashboard.ts, ROADMAP Batch 10 item 11). */
async function startDashboardVisibleGame(targetLength = 7): Promise<StartResult> {
  for (let attempt = 0; attempt < 15; attempt++) {
    const { status, json } = await call("POST", `/api/game/start?target_length=${targetLength}`);
    expect(status).toBe(200);
    const game = json as StartResult;
    if (game.possible_count >= 1) return game;
  }
  throw new Error("No board with a findable word after 15 tries.");
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
async function completeSmallGame(): Promise<{ cookie: string; totalScore: number; gameId: string }> {
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
  return { cookie, totalScore, gameId: game.game_id };
}

// --- English (ROADMAP 6.1) wordlist-scoping helpers, mirroring the hu ones above ------

function findableEn(start: StartResult): string[] {
  const board = lettersOf(start);
  return enDictionary.filter(
    (word) => letterCount(word) <= letterCount(board) && canFormWord(word, board),
  );
}

async function startWithCookieEn(
  targetLength = 5,
  cookie?: string,
): Promise<{ game: StartResult; cookie: string }> {
  const query = new URLSearchParams({ target_length: String(targetLength), wordlist: "en" });
  const { status, json, headers } = await call(
    "POST",
    `/api/v1/game/start?${query}`,
    undefined,
    cookie ? { Cookie: cookie } : undefined,
  );
  expect(status).toBe(200);
  const setCookie = headers.get("set-cookie");
  const cookieValue = cookie ?? setCookie?.split(";", 1)[0];
  if (!cookieValue) throw new Error("No identity cookie minted or supplied.");
  return { game: json as StartResult, cookie: cookieValue };
}

async function completeSmallGameEn(
  existingCookie?: string,
): Promise<{ cookie: string; totalScore: number; gameId: string }> {
  let cookie: string | undefined = existingCookie;
  let game: StartResult | undefined;
  for (let attempt = 0; attempt < 20 && !game; attempt++) {
    const result = await startWithCookieEn(5, cookie);
    cookie = result.cookie;
    if (result.game.possible_count <= 10) game = result.game;
  }
  if (!game || !cookie) throw new Error("No small-enough 5-letter English board found after 20 tries.");

  let totalScore = 0;
  for (const word of findableEn(game)) {
    const { json } = await call("POST", `/api/game/${game.game_id}/guess`, { word }, { Cookie: cookie });
    expect(json.valid).toBe(true);
    totalScore = json.total_score;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  expect(totalScore).toBeGreaterThan(0);
  return { cookie, totalScore, gameId: game.game_id };
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
    // ROADMAP 6.2: a machine-readable result code + the threshold, not display text — the
    // frontend maps this to localised copy in either language.
    expect(json.result).toBe("too_short");
    expect(json.min_length).toBe(3);
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
    // Not exact equality: an approved suggestion (ROADMAP 4.2/5.2) permanently activates
    // a word outside the imported file, so a deployment this suite has run "approve" tests
    // against before can legitimately have more active words than the static file — the
    // count can only grow from here, never shrink below the full import.
    expect(json.total_words).toBeGreaterThanOrEqual(dictionary.length);

    const lengths = await call("GET", "/api/words/lengths");
    expect(lengths.json.available_lengths).toContain(7);
  });

  // --- English wordlist (ROADMAP 6.1) ----------------------------------------
  it("wordlist=en counts and lengths are scoped separately from the default (hu)", async () => {
    const huCount = await call("GET", "/api/words/count");
    const enCount = await call("GET", "/api/v1/words/count?wordlist=en");
    expect(enCount.json.total_words).toBeGreaterThanOrEqual(enDictionary.length);
    // Not just "both present" — they must be different tables, not the same one twice.
    expect(enCount.json.total_words).not.toBe(huCount.json.total_words);

    const enLengths = await call("GET", "/api/v1/words/lengths?wordlist=en");
    // English has thousands of words at every length 5-10 too (verified via the dry-run
    // import above), so it should clear the >=500 bar the same way hu does.
    expect(enLengths.json.available_lengths).toEqual([5, 6, 7, 8, 9, 10]);
  });

  it("wordlist=en starts a board only spellable from the English dictionary", async () => {
    const game = await startWithCookieEn(5).then((r) => r.game);
    const findableWords = findableEn(game);
    expect(findableWords.length).toBeGreaterThan(0);
    // Every one of this board's findable words must actually be in the English list —
    // proof the game was drawn from wordlist_id='en', not silently falling back to hu.
    for (const word of findableWords) expect(enDictionary).toContain(word);
  });

  it("keeps leaderboards wordlist-scoped: a hu score and an en score for the same player don't cross-contaminate (ROADMAP 6.1)", async () => {
    const hu = await completeSmallGame();
    // Reuse the same identity cookie so "your_best" is genuinely testing scoping, not just
    // two different anonymous players.
    const en = await completeSmallGameEn(hu.cookie);

    const huTop = await call(
      "GET",
      "/api/v1/scores/top?length=5&wordlist=hu",
      undefined,
      { Cookie: hu.cookie },
    );
    const enTop = await call(
      "GET",
      "/api/v1/scores/top?length=5&wordlist=en",
      undefined,
      { Cookie: hu.cookie },
    );
    expect(huTop.json.your_best.final_score).toBe(hu.totalScore);
    expect(enTop.json.your_best.final_score).toBe(en.totalScore);
    // completeSmallGame(Both variants) pace their guesses 400ms apart to dodge the
    // anti-cheat rate limit — running two of them plus several more requests reliably
    // blows past Vitest's 5s default testTimeout even though nothing is stuck (a gotcha
    // already hit once before, ROADMAP memory).
  }, 15000);

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

  // --- Preferred theme persistence (ROADMAP Batch 10 item 7: dark mode) ------
  it("round-trips a player's preferred theme through PATCH/GET, and rejects an unknown value", async () => {
    const minted = await call("POST", "/api/game/start?target_length=7");
    const cookieValue = minted.headers.get("set-cookie")!.split(";", 1)[0];
    const auth = { Cookie: cookieValue };

    const before = await call("GET", "/api/v1/me/preferences", undefined, auth);
    expect(before.json.preferred_theme).toBeNull();

    const patched = await call("PATCH", "/api/v1/me/preferences", { preferred_theme: "dark" }, auth);
    expect(patched.status).toBe(200);
    expect(patched.json.preferred_theme).toBe("dark");

    const after = await call("GET", "/api/v1/me/preferences", undefined, auth);
    expect(after.json.preferred_theme).toBe("dark");

    const bad = await call("PATCH", "/api/v1/me/preferences", { preferred_theme: "sepia" }, auth);
    expect(bad.status).toBe(422);
  });

  // --- Sound-effects preference (ROADMAP Batch 10 item 8) -------------------
  it("round-trips a player's sound_enabled flag through PATCH/GET, and rejects a non-boolean", async () => {
    const minted = await call("POST", "/api/game/start?target_length=7");
    const cookieValue = minted.headers.get("set-cookie")!.split(";", 1)[0];
    const auth = { Cookie: cookieValue };

    const before = await call("GET", "/api/v1/me/preferences", undefined, auth);
    expect(before.json.sound_enabled).toBeNull();

    const patched = await call("PATCH", "/api/v1/me/preferences", { sound_enabled: true }, auth);
    expect(patched.status).toBe(200);
    expect(patched.json.sound_enabled).toBe(true);

    const after = await call("GET", "/api/v1/me/preferences", undefined, auth);
    expect(after.json.sound_enabled).toBe(true);

    const bad = await call("PATCH", "/api/v1/me/preferences", { sound_enabled: "yes" }, auth);
    expect(bad.status).toBe(422);
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
  //
  // Product decision 2026-07-30: per-word history (which words a player failed/solved) is
  // no longer exposed to players at all — not just hidden in the UI, removed from this
  // response entirely (lib/word-stats.ts's getMyStats). word_stats now drives target
  // selection server-side instead (pickPersonalizedWord/pickEasyWord's mastery-cooldown
  // and fresh-word preference) — not practically forceable end-to-end through this
  // black-box HTTP surface (the target word is drawn server-side at random, can't be
  // requested, and the cooldown window is 100 games), so that logic is reviewed at the
  // migration/code level instead, the same way ROADMAP 6.1's word_stats primary-key
  // non-collision was. The two tests below only check what's actually observable here:
  // the write path still fires (game/start no longer 500s, me/stats still aggregates
  // correctly) and the removed field is actually gone, not just unused.
  it("me/stats reads as an empty sheet with no identity, and never includes failed_words", async () => {
    const { json } = await call("GET", "/api/v1/me/stats");
    expect(json.games_played).toBe(0);
    expect(json.completion_rate).toBe(0);
    expect(json.longest_word_found).toBeNull();
    expect(json).not.toHaveProperty("failed_words");
  });

  it("records a given-up game towards games_played without leaking failed_words", async () => {
    const { game, cookie } = await startWithCookie();
    const giveUp = await call("POST", `/api/game/${game.game_id}/give_up`, undefined, {
      Cookie: cookie,
    });
    expect(giveUp.status).toBe(200);

    const { json } = await call("GET", "/api/v1/me/stats", undefined, { Cookie: cookie });
    expect(json.games_played).toBeGreaterThanOrEqual(1);
    expect(json).not.toHaveProperty("failed_words");
  });

  it("start no longer echoes is_previously_failed (removed 2026-07-30, was a history leak)", async () => {
    const game = await start();
    expect(game).not.toHaveProperty("is_previously_failed");
  });

  // --- Achievements (ROADMAP Batch 10 item 10) ------------------------------------
  //
  // Evaluated + persisted server-side only at a game's terminal transition
  // (lib/game.ts finalizeWordStats), so "first_word" means "ended a game in which you
  // found at least one word", not "found a word this instant". The daily-streak and
  // both-wordlists achievements aren't exercised here — they'd need a real daily_puzzles
  // row minted against the target deployment (see the IS_PRODUCTION-gated daily tests).
  it("me/achievements with no identity returns the full catalog, everything locked", async () => {
    const { status, json } = await call("GET", "/api/v1/me/achievements");
    expect(status).toBe(200);
    const keys = json.achievements.map((a: { key: string }) => a.key);
    expect(new Set(keys)).toEqual(new Set(ACHIEVEMENT_KEYS));
    expect(
      json.achievements.every((a: { unlocked_at: string | null }) => a.unlocked_at === null),
    ).toBe(true);
  });

  it("finishing a game with a found word unlocks first_word (and full_clear on a real clear)", async () => {
    // A small board played to the end as one identity. Whether it actually clears depends
    // on the local wordlist file agreeing with the live `words` table (a divergence this
    // repo has hit — PR #27/#47), so the full-clear assertions are gated on the last
    // guess actually reporting game_ended.
    let cookie: string | undefined;
    let game: StartResult | undefined;
    for (let attempt = 0; attempt < 20 && !game; attempt++) {
      const r = await startWithCookie(5, cookie);
      cookie = r.cookie;
      if (r.game.possible_count <= 10) game = r.game;
    }
    if (!game || !cookie) throw new Error("No small-enough 5-letter board found after 20 tries.");

    let anyFound = false;
    let lastEnded = false;
    for (const word of findable(game)) {
      const { json } = await call(
        "POST",
        `/api/game/${game.game_id}/guess`,
        { word },
        { Cookie: cookie },
      );
      if (json.valid) {
        anyFound = true;
        lastEnded = Boolean(json.game_ended);
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    expect(anyFound).toBe(true);
    // Guarantee a terminal transition so finalizeWordStats (and the achievement eval) runs
    // even if the board didn't clear.
    if (!lastEnded) {
      await call("POST", `/api/game/${game.game_id}/give_up`, undefined, { Cookie: cookie });
    }

    const { status, json } = await call("GET", "/api/v1/me/achievements", undefined, {
      Cookie: cookie,
    });
    expect(status).toBe(200);
    const unlockedAt = new Map<string, string | null>(
      json.achievements.map((a: { key: string; unlocked_at: string | null }) => [
        a.key,
        a.unlocked_at,
      ]),
    );
    expect(unlockedAt.get("first_word")).toBeTruthy();
    if (lastEnded) {
      expect(unlockedAt.get("full_clear")).toBeTruthy();
      // This loop never takes a hint.
      expect(unlockedAt.get("full_clear_no_hints")).toBeTruthy();
    }
  }, 30_000);

  // --- Account data deletion (ROADMAP "Privacy page + data deletion endpoint") ---
  //
  // Safe to run against any deployment including production: the round-trip test deletes
  // only the fresh player it just minted, and the no-identity case has no side effects.
  it("DELETE /api/v1/me with no identity is a no-op that still clears the cookie", async () => {
    const { status, json, headers } = await call("DELETE", "/api/v1/me");
    expect(status).toBe(200);
    expect(json.deleted).toBe(false);
    expect(headers.get("set-cookie")).toMatch(/bv_anon=;.*Max-Age=0/i);
  });

  it("DELETE /api/v1/me wipes the player: stats and achievements read empty afterwards", async () => {
    // Create a player with real data: one given-up game.
    const { game, cookie } = await startWithCookie();
    await call("POST", `/api/game/${game.game_id}/give_up`, undefined, { Cookie: cookie });

    const before = await call("GET", "/api/v1/me/stats", undefined, { Cookie: cookie });
    expect(before.json.games_played).toBeGreaterThanOrEqual(1);

    const del = await call("DELETE", "/api/v1/me", undefined, { Cookie: cookie });
    expect(del.status).toBe(200);
    expect(del.json.deleted).toBe(true);
    expect(del.headers.get("set-cookie")).toMatch(/bv_anon=;.*Max-Age=0/i);

    // The same cookie now points at a player row that no longer exists — every /me route
    // treats that the same as "no identity": an empty sheet, not an error.
    const afterStats = await call("GET", "/api/v1/me/stats", undefined, { Cookie: cookie });
    expect(afterStats.status).toBe(200);
    expect(afterStats.json.games_played).toBe(0);

    const afterAch = await call("GET", "/api/v1/me/achievements", undefined, { Cookie: cookie });
    expect(afterAch.status).toBe(200);
    expect(
      afterAch.json.achievements.every((a: { unlocked_at: string | null }) => a.unlocked_at === null),
    ).toBe(true);

    // A second delete of the same (now-gone) player is a clean no-op.
    const again = await call("DELETE", "/api/v1/me", undefined, { Cookie: cookie });
    expect(again.status).toBe(200);
    expect(again.json.deleted).toBe(false);
  }, 20_000);

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

  // --- Magic Link admin login (backend prep only, not yet wired to a frontend) ---
  it("rejects a garbage bearer token the same as a missing admin token", async () => {
    // No live Neon Auth issuer to test a real session against yet (NEON_AUTH_JWKS_URL
    // unset in every environment so far) — this only proves a malformed/unverifiable
    // token can't slip through as if it were a valid session, same shape as the existing
    // wrong-x-admin-token case below.
    const garbageBearer = await call("GET", "/api/v1/admin/queue", undefined, {
      Authorization: "Bearer this-is-not-a-real-jwt",
    });
    expect(garbageBearer.status).toBe(401);
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

  // --- Batch 5.2: review queue mutations --------------------------------------
  it("resolves a word report: reject reactivates, accept deactivates, then it's gone from the queue", async () => {
    if (!ADMIN_TOKEN) return; // every assertion below needs the real token

    const game = await start();
    const word = findable(game)[0];
    const { cookie } = await startWithCookie();
    await call("POST", "/api/v1/words/report", { word }, { Cookie: cookie });

    const queue = await call("GET", "/api/v1/admin/queue", undefined, { "x-admin-token": ADMIN_TOKEN });
    const entry = queue.json.reports.find((r: any) => r.word === word);
    expect(entry).toBeDefined();

    const rejected = await call(
      "POST",
      `/api/v1/admin/reports/${entry.word_id}/resolve`,
      { decision: "reject" },
      { "x-admin-token": ADMIN_TOKEN },
    );
    expect(rejected.status).toBe(200);
    expect(rejected.json.active).toBe(true);

    // No open reports left for this word — resolving again 404s.
    const again = await call(
      "POST",
      `/api/v1/admin/reports/${entry.word_id}/resolve`,
      { decision: "reject" },
      { "x-admin-token": ADMIN_TOKEN },
    );
    expect(again.status).toBe(404);

    // Invalid decision value is a validation error, not a silent no-op.
    const invalid = await call(
      "POST",
      `/api/v1/admin/reports/${entry.word_id}/resolve`,
      { decision: "maybe" },
      { "x-admin-token": ADMIN_TOKEN },
    );
    expect(invalid.status).toBe(422);
  });

  it("reactivates a word directly, independent of report status", async () => {
    if (!ADMIN_TOKEN) return;

    const game = await startUntil((g) => findable(g).length > 0);
    const word = findable(game)[0];
    const { cookie } = await startWithCookie();
    await call("POST", "/api/v1/words/report", { word }, { Cookie: cookie });

    const queue = await call("GET", "/api/v1/admin/queue", undefined, { "x-admin-token": ADMIN_TOKEN });
    const entry = queue.json.reports.find((r: any) => r.word === word);

    await call(
      "POST",
      `/api/v1/admin/reports/${entry.word_id}/resolve`,
      { decision: "accept" },
      { "x-admin-token": ADMIN_TOKEN },
    ); // deactivates it

    const reactivated = await call(
      "POST",
      `/api/v1/admin/words/${entry.word_id}/reactivate`,
      undefined,
      { "x-admin-token": ADMIN_TOKEN },
    );
    expect(reactivated.status).toBe(200);
    expect(reactivated.json.active).toBe(true);

    const unknown = await call("POST", "/api/v1/admin/words/999999999/reactivate", undefined, {
      "x-admin-token": ADMIN_TOKEN,
    });
    expect(unknown.status).toBe(404);
  });

  it("resolves a word suggestion: approve activates it, re-resolving conflicts", async () => {
    if (!ADMIN_TOKEN) return;

    const { cookie } = await startWithCookie();
    const alphabet = "BDFGKLMNPRST";
    let novel = "";
    do {
      novel = Array.from({ length: 10 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join(
        "",
      );
    } while (dictionary.includes(novel));

    const suggested = await call("POST", "/api/v1/words/suggest", { word: novel }, { Cookie: cookie });
    expect(suggested.json.already_present).toBe(false);

    const queue = await call("GET", "/api/v1/admin/queue", undefined, { "x-admin-token": ADMIN_TOKEN });
    const entry = queue.json.suggestions.find((s: any) => s.word === novel);
    expect(entry).toBeDefined();

    const approved = await call(
      "POST",
      `/api/v1/admin/suggestions/${entry.id}/resolve`,
      { decision: "approve" },
      { "x-admin-token": ADMIN_TOKEN },
    );
    expect(approved.status).toBe(200);

    // Now active: suggesting it again reads as already_present, not a fresh suggestion.
    const again = await call("POST", "/api/v1/words/suggest", { word: novel }, { Cookie: cookie });
    expect(again.json.already_present).toBe(true);

    // Already resolved — re-resolving is a conflict, not a silent success.
    const conflict = await call(
      "POST",
      `/api/v1/admin/suggestions/${entry.id}/resolve`,
      { decision: "approve" },
      { "x-admin-token": ADMIN_TOKEN },
    );
    expect(conflict.status).toBe(409);
  });

  // --- Batch 5.2 item 1: word search, edit, delete -----------------------------
  it("gates word search/edit/delete behind the admin token", async () => {
    const noToken = await call("GET", "/api/v1/admin/words?q=xyz");
    expect(noToken.status).toBe(401);

    const wrongToken = await call("PATCH", "/api/v1/admin/words/1", { word: "X" }, {
      "x-admin-token": "definitely-not-the-real-token",
    });
    expect(wrongToken.status).toBe(401);
  });

  it("searches, edits and deletes a word", async () => {
    if (!ADMIN_TOKEN) return; // every assertion below needs the real token
    const adminHeaders = { "x-admin-token": ADMIN_TOKEN };

    const { cookie } = await startWithCookie();
    const alphabet = "BDFGKLMNPRST";
    const randomWord = () =>
      Array.from({ length: 10 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
    let novel = randomWord();
    while (dictionary.includes(novel)) novel = randomWord();

    await call("POST", "/api/v1/words/suggest", { word: novel }, { Cookie: cookie });

    const found = await call(
      "GET",
      `/api/v1/admin/words?q=${novel}`,
      undefined,
      adminHeaders,
    );
    expect(found.status).toBe(200);
    const row = found.json.words.find((w: any) => w.word === novel);
    expect(row).toBeDefined();
    expect(row.active).toBe(false);
    expect(row.source).toBe("suggested");

    // Editing to a spelling already in the dictionary conflicts rather than silently
    // merging two rows into one.
    const conflict = await call(
      "PATCH",
      `/api/v1/admin/words/${row.id}`,
      { word: dictionary[0] },
      adminHeaders,
    );
    expect(conflict.status).toBe(409);

    // Too short to be a real word — the same 3-15 letter rule words.ts enforces everywhere.
    const tooShort = await call("PATCH", `/api/v1/admin/words/${row.id}`, { word: "AB" }, adminHeaders);
    expect(tooShort.status).toBe(422);

    let renamed = randomWord();
    while (dictionary.includes(renamed) || renamed === novel) renamed = randomWord();
    const edited = await call(
      "PATCH",
      `/api/v1/admin/words/${row.id}`,
      { word: renamed },
      adminHeaders,
    );
    expect(edited.status).toBe(200);
    expect(edited.json.word).toBe(renamed);

    const afterEdit = await call(
      "GET",
      `/api/v1/admin/words?q=${renamed}`,
      undefined,
      adminHeaders,
    );
    expect(afterEdit.json.words.some((w: any) => w.word === renamed)).toBe(true);

    const deleted = await call("DELETE", `/api/v1/admin/words/${row.id}`, undefined, adminHeaders);
    expect(deleted.status).toBe(200);

    const afterDelete = await call(
      "GET",
      `/api/v1/admin/words?q=${renamed}`,
      undefined,
      adminHeaders,
    );
    expect(afterDelete.json.words.some((w: any) => w.word === renamed)).toBe(false);

    // Already gone — a second delete/edit 404s rather than silently no-op'ing.
    const deleteAgain = await call("DELETE", `/api/v1/admin/words/${row.id}`, undefined, adminHeaders);
    expect(deleteAgain.status).toBe(404);
  });

  // --- Batch 5.2 item 2: config editor ----------------------------------------
  it("gates the config endpoints behind the admin token", async () => {
    const noToken = await call("GET", "/api/v1/admin/config");
    expect(noToken.status).toBe(401);

    const wrongToken = await call("PATCH", "/api/v1/admin/config/hint_cost", { value: 5 }, {
      "x-admin-token": "definitely-not-the-real-token",
    });
    expect(wrongToken.status).toBe(401);
  });

  it("lists, updates and restores a config value; rejects unknown keys and bad values", async () => {
    if (!ADMIN_TOKEN) return;
    const adminHeaders = { "x-admin-token": ADMIN_TOKEN };

    const list = await call("GET", "/api/v1/admin/config", undefined, adminHeaders);
    expect(list.status).toBe(200);
    const hintCost = list.json.config.find((row: any) => row.key === "hint_cost");
    expect(hintCost).toBeDefined();
    const original = hintCost.value;

    const unknownKey = await call(
      "PATCH",
      "/api/v1/admin/config/not_a_real_key",
      { value: 1 },
      adminHeaders,
    );
    expect(unknownKey.status).toBe(404);

    const badValue = await call(
      "PATCH",
      "/api/v1/admin/config/hint_cost",
      { value: "free" },
      adminHeaders,
    );
    expect(badValue.status).toBe(422);

    const negative = await call(
      "PATCH",
      "/api/v1/admin/config/hint_cost",
      { value: -1 },
      adminHeaders,
    );
    expect(negative.status).toBe(422);

    const updated = await call(
      "PATCH",
      "/api/v1/admin/config/hint_cost",
      { value: original + 1 },
      adminHeaders,
    );
    expect(updated.status).toBe(200);
    expect(updated.json.value).toBe(original + 1);

    // lib/config.ts caches reads per warm serverless instance for up to 30s, and a PATCH
    // only clears the cache on the instance that served it — a GET can briefly land on a
    // different instance still holding the pre-update value, so poll rather than assert
    // on the first read.
    let row: { value: number } | undefined;
    for (let attempt = 0; attempt < 8 && row?.value !== original + 1; attempt++) {
      const relisted = await call("GET", "/api/v1/admin/config", undefined, adminHeaders);
      row = relisted.json.config.find((r: any) => r.key === "hint_cost");
      if (row?.value !== original + 1) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    expect(row?.value).toBe(original + 1);

    // Restore, so this test doesn't leave the shared preview/production config mutated
    // for every other test run that depends on the default hint cost.
    const restored = await call(
      "PATCH",
      "/api/v1/admin/config/hint_cost",
      { value: original },
      adminHeaders,
    );
    expect(restored.status).toBe(200);
  }, 15000); // longer than the default: the read-back above polls for up to ~8s to ride
  // out lib/config.ts's per-instance cache (see that assertion's own comment).

  // --- Batch 10 item 14: player-facing control visibility --------------------
  it("gates the UI-config endpoints behind the admin token", async () => {
    const noToken = await call("GET", "/api/v1/admin/ui-config");
    expect(noToken.status).toBe(401);

    const wrongToken = await call(
      "PATCH",
      "/api/v1/admin/ui-config/show_length_selector",
      { value: false },
      { "x-admin-token": "definitely-not-the-real-token" },
    );
    expect(wrongToken.status).toBe(401);
  });

  it("lists UI config and rejects unknown keys / malformed values", async () => {
    if (!ADMIN_TOKEN) return;
    const adminHeaders = { "x-admin-token": ADMIN_TOKEN };

    const list = await call("GET", "/api/v1/admin/ui-config", undefined, adminHeaders);
    expect(list.status).toBe(200);
    const keys = list.json.config.map((row: any) => row.key).sort();
    expect(keys).toEqual(
      [
        "default_length",
        "default_wordlist",
        "show_easy_mode",
        "show_length_selector",
        "show_wordlist_selector",
      ].sort(),
    );

    const unknownKey = await call(
      "PATCH",
      "/api/v1/admin/ui-config/not_a_real_key",
      { value: true },
      adminHeaders,
    );
    expect(unknownKey.status).toBe(404);

    // a boolean key must reject a non-boolean
    const badBool = await call(
      "PATCH",
      "/api/v1/admin/ui-config/show_length_selector",
      { value: "maybe" },
      adminHeaders,
    );
    expect(badBool.status).toBe(422);

    // default_length must stay in 5..10
    const badLength = await call(
      "PATCH",
      "/api/v1/admin/ui-config/default_length",
      { value: 99 },
      adminHeaders,
    );
    expect(badLength.status).toBe(422);

    // default_wordlist must be a known code
    const badWordlist = await call(
      "PATCH",
      "/api/v1/admin/ui-config/default_wordlist",
      { value: "de" },
      adminHeaders,
    );
    expect(badWordlist.status).toBe(422);
  });

  it("a hidden length selector forces the configured default in game/start", async () => {
    if (!ADMIN_TOKEN || IS_PRODUCTION) return; // mutates a player-visible setting
    const adminHeaders = { "x-admin-token": ADMIN_TOKEN };

    const list = await call("GET", "/api/v1/admin/ui-config", undefined, adminHeaders);
    const origShow = list.json.config.find((r: any) => r.key === "show_length_selector").value;
    const origLen = list.json.config.find((r: any) => r.key === "default_length").value;
    const forcedLen = origLen === 6 ? 8 : 6; // a value we can prove wasn't the request

    try {
      expect(
        (await call("PATCH", "/api/v1/admin/ui-config/default_length", { value: forcedLen }, adminHeaders)).status,
      ).toBe(200);
      expect(
        (await call("PATCH", "/api/v1/admin/ui-config/show_length_selector", { value: false }, adminHeaders)).status,
      ).toBe(200);

      // Ride out lib/config.ts's per-instance cache (~30s TTL, only the PATCH-serving
      // instance is cleared) by starting a few games until the forcing takes effect.
      let started: { status: number; json: any } | undefined;
      for (let attempt = 0; attempt < 12; attempt++) {
        started = await call(
          "POST",
          "/api/v1/game/start?target_length=9",
          undefined,
          { ...PINNED_COOKIE_HEADER },
        );
        if (started.json?.target_length === forcedLen) break;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      expect(started?.status).toBe(200);
      expect(started?.json.target_length).toBe(forcedLen); // NOT the requested 9
      expect(started?.json.ui.show_length_selector).toBe(false);
    } finally {
      await call("PATCH", "/api/v1/admin/ui-config/show_length_selector", { value: origShow }, adminHeaders);
      await call("PATCH", "/api/v1/admin/ui-config/default_length", { value: origLen }, adminHeaders);
    }
  }, 30000);

  // --- Batch 10 item 1: daily puzzle + streaks -------------------------------
  // These create and read today's real `daily_puzzles` row, so they run only against a
  // preview deployment (isolated, disposable Neon DB) — never production, where a test's
  // random pick would silently become the actual daily puzzle everyone gets that day.

  async function startDaily(
    cookie?: string,
    query = "",
  ): Promise<{ json: any; cookie: string }> {
    const { status, json, headers } = await call(
      "POST",
      `/api/v1/daily/start${query}`,
      undefined,
      cookie ? { Cookie: cookie } : undefined,
    );
    expect(status).toBe(200);
    const resolved = cookie ?? headers.get("set-cookie")?.split(";", 1)[0];
    if (!resolved) throw new Error("No identity cookie for daily/start.");
    return { json, cookie: resolved };
  }

  it("daily/start hands every player the same board for the day", async () => {
    if (IS_PRODUCTION) return;
    const a = await startDaily();
    const b = await startDaily();
    expect(a.json.scrambled_letters).toBe(b.json.scrambled_letters);
    expect(a.json.target_length).toBe(b.json.target_length);
    expect(a.json.possible_count).toBe(b.json.possible_count);
    expect(a.json.game_id).not.toBe(b.json.game_id); // separate games, one shared board
    expect(a.json.daily.puzzle_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(a.json.difficulty).toBe("normal");
  });

  it("grades only the first daily attempt; a replay is flagged as not counting", async () => {
    if (IS_PRODUCTION) return;

    // A fresh identity so the streak starts from nothing.
    const first = await startDaily(undefined, "?target_length=5");
    const { cookie } = first;

    // Reconstruct the board and play every findable word — that necessarily includes the
    // target, so the game is "completed" — then force a terminal transition.
    const board = (first.json.scrambled_letters as string).split(" ").join("");
    const words = dictionary
      .filter((w) => letterCount(w) <= letterCount(board) && canFormWord(w, board))
      .slice(0, 40);
    for (const word of words) {
      await call("POST", `/api/v1/game/${first.json.game_id}/guess`, { word }, { Cookie: cookie });
      await new Promise((r) => setTimeout(r, 400));
    }
    await call("POST", `/api/v1/game/${first.json.game_id}/give_up`, undefined, { Cookie: cookie });

    const view1 = await call("GET", "/api/v1/daily?target_length=5", undefined, { Cookie: cookie });
    expect(view1.status).toBe(200);
    expect(view1.json.already_played).toBe(true);
    expect(view1.json.your_result).not.toBeNull();
    expect(typeof view1.json.your_result.final_score).toBe("number");
    expect(view1.json.leaderboard.length).toBeGreaterThanOrEqual(1);
    const { final_score: gradedScore, completed: gradedCompleted } = view1.json.your_result;
    // The loop guessed every findable word, so the target was among them unless it was
    // deactivated server-side — if completed, the day counts toward the streak.
    if (gradedCompleted) expect(view1.json.streak.current).toBeGreaterThanOrEqual(1);

    // A replay still plays, but the server marks it as already graded.
    const replay = await startDaily(cookie, "?target_length=5");
    expect(replay.json.daily.already_graded).toBe(true);
    await call("POST", `/api/v1/game/${replay.json.game_id}/give_up`, undefined, { Cookie: cookie });

    const view2 = await call("GET", "/api/v1/daily?target_length=5", undefined, { Cookie: cookie });
    expect(view2.json.your_result.final_score).toBe(gradedScore); // first attempt frozen
    expect(view2.json.your_result.completed).toBe(gradedCompleted);
  }, 60000);

  it("a hidden length selector also pins the daily puzzle's length", async () => {
    if (!ADMIN_TOKEN || IS_PRODUCTION) return;
    const adminHeaders = { "x-admin-token": ADMIN_TOKEN };

    const list = await call("GET", "/api/v1/admin/ui-config", undefined, adminHeaders);
    const origShow = list.json.config.find((r: any) => r.key === "show_length_selector").value;
    const origLen = list.json.config.find((r: any) => r.key === "default_length").value;
    const forcedLen = origLen === 6 ? 8 : 6;

    try {
      expect(
        (await call("PATCH", "/api/v1/admin/ui-config/default_length", { value: forcedLen }, adminHeaders)).status,
      ).toBe(200);
      expect(
        (await call("PATCH", "/api/v1/admin/ui-config/show_length_selector", { value: false }, adminHeaders)).status,
      ).toBe(200);

      let view: { status: number; json: any } | undefined;
      for (let attempt = 0; attempt < 12; attempt++) {
        view = await call("GET", "/api/v1/daily?target_length=9", undefined, PINNED_COOKIE_HEADER);
        if (view.json?.target_length === forcedLen) break;
        await new Promise((r) => setTimeout(r, 1500));
      }
      expect(view?.json.target_length).toBe(forcedLen); // NOT the requested 9

      const started = await call(
        "POST",
        "/api/v1/daily/start?target_length=9",
        undefined,
        { ...PINNED_COOKIE_HEADER },
      );
      expect(started.json.target_length).toBe(forcedLen);
      expect(started.json.ui.show_length_selector).toBe(false);
    } finally {
      await call("PATCH", "/api/v1/admin/ui-config/show_length_selector", { value: origShow }, adminHeaders);
      await call("PATCH", "/api/v1/admin/ui-config/default_length", { value: origLen }, adminHeaders);
    }
  }, 30000);

  // --- Batch 5.2 item 3: player and leaderboard maintenance -------------------
  it("gates player/score maintenance behind the admin token", async () => {
    const noToken = await call("GET", "/api/v1/admin/players?q=xyz");
    expect(noToken.status).toBe(401);

    const wrongToken = await call("GET", "/api/v1/admin/scores", undefined, {
      "x-admin-token": "definitely-not-the-real-token",
    });
    expect(wrongToken.status).toBe(401);
  });

  it("searches and renames a player", async () => {
    if (!ADMIN_TOKEN) return;
    const adminHeaders = { "x-admin-token": ADMIN_TOKEN };

    // game/start's response echoes player_id directly (lib/game.ts's startGame) — no need
    // to parse the signed cookie ourselves to find this test's own player row.
    const { game } = await startWithCookie();
    const playerId = (game as unknown as { player_id: string }).player_id;
    expect(playerId).toBeTruthy();

    const uniqueName = `Teszt Játékos ${Math.random().toString(36).slice(2, 8)}`;
    const renamed = await call(
      "PATCH",
      `/api/v1/admin/players/${playerId}`,
      { display_name: uniqueName },
      adminHeaders,
    );
    expect(renamed.status).toBe(200);
    expect(renamed.json.display_name).toBe(uniqueName);

    const found = await call(
      "GET",
      `/api/v1/admin/players?q=${encodeURIComponent(uniqueName)}`,
      undefined,
      adminHeaders,
    );
    expect(found.status).toBe(200);
    expect(found.json.players.some((p: any) => p.id === playerId)).toBe(true);

    // Too long — the admin tool's own sanity cap, not tied to any existing player-facing limit.
    const tooLong = await call(
      "PATCH",
      `/api/v1/admin/players/${playerId}`,
      { display_name: "x".repeat(21) },
      adminHeaders,
    );
    expect(tooLong.status).toBe(422);

    const unknown = await call(
      "PATCH",
      "/api/v1/admin/players/00000000-0000-0000-0000-000000000000",
      { display_name: "nope" },
      adminHeaders,
    );
    expect(unknown.status).toBe(404);
  });

  it("lists leaderboard entries and disqualifies one", async () => {
    if (!ADMIN_TOKEN) return;
    const adminHeaders = { "x-admin-token": ADMIN_TOKEN };

    // completeSmallGame's own game_id, not "the top of the listing" — this is a shared,
    // persistent database, so a low-scoring small board isn't guaranteed to rank inside
    // the (limited, real-score-ordered) admin listing at all; disqualify targets it
    // directly by id instead of depending on where it ranks.
    const { totalScore, gameId } = await completeSmallGame();
    expect(totalScore).toBeGreaterThan(0);

    const entries = await call("GET", "/api/v1/admin/scores?length=5", undefined, adminHeaders);
    expect(entries.status).toBe(200);
    expect(Array.isArray(entries.json.entries)).toBe(true);

    const disqualified = await call(
      "POST",
      `/api/v1/admin/games/${gameId}/disqualify`,
      undefined,
      adminHeaders,
    );
    expect(disqualified.status).toBe(200);

    // Gone from the admin listing (disqualified_at is null filter) ...
    const afterEntries = await call("GET", "/api/v1/admin/scores?length=5", undefined, adminHeaders);
    expect(afterEntries.json.entries.some((e: any) => e.id === gameId)).toBe(false);

    // ... already-disqualified is a conflict, not a silent no-op ...
    const again = await call(
      "POST",
      `/api/v1/admin/games/${gameId}/disqualify`,
      undefined,
      adminHeaders,
    );
    expect(again.status).toBe(409);

    // ... and an unknown game id 404s.
    const unknown = await call(
      "POST",
      "/api/v1/admin/games/00000000-0000-0000-0000-000000000000/disqualify",
      undefined,
      adminHeaders,
    );
    expect(unknown.status).toBe(404);
  }, 15000); // completeSmallGame() alone paces its guesses 400ms apart to stay under the
  // anti-cheat rate limit, plus several more round trips here — comfortably over the

  // --- Batch 10 item 12: admin per-game drill-down -----------------------------
  it("gates and returns one game's full guess timeline, revealing the target word", async () => {
    const noToken = await call("GET", "/api/v1/admin/games/00000000-0000-0000-0000-000000000000");
    expect(noToken.status).toBe(401);

    if (!ADMIN_TOKEN) return;
    const adminHeaders = { "x-admin-token": ADMIN_TOKEN };

    const { totalScore, gameId } = await completeSmallGame();
    expect(totalScore).toBeGreaterThan(0);

    const detail = await call("GET", `/api/v1/admin/games/${gameId}`, undefined, adminHeaders);
    expect(detail.status).toBe(200);
    expect(detail.json.game.id).toBe(gameId);
    // completeSmallGame() finds every findable word, so found_count reaches possible_count
    // and the game auto-finishes (ROADMAP 3.2) — admin-only, so revealing target_word here
    // does not conflict with the player-facing no-word-history rule (Batch 10 item 3).
    expect(typeof detail.json.game.target_word).toBe("string");
    expect(detail.json.game.target_word.length).toBeGreaterThan(0);
    expect(detail.json.game.found_count).toBe(detail.json.game.possible_count);
    expect(detail.json.game.status).toBe("finished");

    expect(Array.isArray(detail.json.guesses)).toBe(true);
    expect(detail.json.guesses.length).toBe(detail.json.game.found_count);
    for (const guess of detail.json.guesses) {
      expect(guess.correct).toBe(true);
      expect(typeof guess.word).toBe("string");
      expect(typeof guess.created_at).toBe("string");
    }
    expect(Array.isArray(detail.json.hints)).toBe(true);
    expect(detail.json.hints).toHaveLength(0);

    const unknown = await call(
      "GET",
      "/api/v1/admin/games/00000000-0000-0000-0000-000000000000",
      undefined,
      adminHeaders,
    );
    expect(unknown.status).toBe(404);
  }, 15000);
  // suite's default timeout even though nothing is actually stuck.

  // --- Batch 5.2 item 4: admin dashboard ---------------------------------------
  it("gates the admin dashboard behind the admin token", async () => {
    const noToken = await call("GET", "/api/v1/admin/dashboard");
    expect(noToken.status).toBe(401);

    const wrongToken = await call("GET", "/api/v1/admin/dashboard", undefined, {
      "x-admin-token": "definitely-not-the-real-token",
    });
    expect(wrongToken.status).toBe(401);
  });

  it("returns 30 days of zero-filled daily stats, most-failed words and queue sizes", async () => {
    if (!ADMIN_TOKEN) return;
    const adminHeaders = { "x-admin-token": ADMIN_TOKEN };

    // Play and fail one game first so there's at least one word_stats row: a fresh Neon
    // branch/preview could otherwise leave most_failed_words empty and this test would
    // only be checking the shape, never the aggregation itself. Fresh (never-pinned)
    // player — the assertion below is that today's games/DAU are non-zero, which excludes
    // an is_ci-pinned identity (see CONTRACT_CI_PLAYER_COOKIE note).
    const game = await startDashboardVisibleGame(7);
    await call("POST", `/api/game/${game.game_id}/give_up`);

    const dashboard = await call("GET", "/api/v1/admin/dashboard", undefined, adminHeaders);
    expect(dashboard.status).toBe(200);

    expect(dashboard.json.daily).toHaveLength(30);
    // Today is always the last row, and a game just started today, so it's never zero —
    // the one non-tautological assertion the zero-filled series admits without a clean DB.
    const today = dashboard.json.daily[29];
    expect(today.games).toBeGreaterThan(0);
    expect(today.dau).toBeGreaterThan(0);

    expect(Array.isArray(dashboard.json.most_failed_words)).toBe(true);
    expect(dashboard.json.most_failed_words.length).toBeGreaterThan(0);
    for (const row of dashboard.json.most_failed_words) {
      expect(row.times_failed).toBeGreaterThan(0);
      // Wordlist-scoped (Batch 10 follow-up fix) so a spelling shared between hu/en can't
      // silently merge its counts across languages, mirroring getMyStats's own fix for the
      // same bug shape (PR #37).
      expect(typeof row.wordlist).toBe("string");
      expect(row.wordlist.length).toBeGreaterThan(0);
    }

    expect(dashboard.json.queue_size.reports).toBeGreaterThanOrEqual(0);
    expect(dashboard.json.queue_size.suggestions).toBeGreaterThanOrEqual(0);
  });

  // --- Batch 10 item 13: player-stat drill-down ---------------------------------
  it("reports player-stat drill-down: averages, time buckets and a country distribution", async () => {
    if (!ADMIN_TOKEN) return;
    const adminHeaders = { "x-admin-token": ADMIN_TOKEN };

    // A game that actually reaches a terminal status, so it counts toward the
    // avg-games/avg-duration figures (lib/admin-dashboard.ts's TERMINAL_STATUSES). Fresh
    // (never-pinned) player, since those figures exclude is_ci identities
    // (see CONTRACT_CI_PLAYER_COOKIE note).
    const game = await startDashboardVisibleGame(7);
    await call("POST", `/api/game/${game.game_id}/give_up`);

    const dashboard = await call("GET", "/api/v1/admin/dashboard", undefined, adminHeaders);
    expect(dashboard.status).toBe(200);

    expect(dashboard.json.player_stats.avg_games_per_player).toBeGreaterThan(0);
    expect(dashboard.json.player_stats.avg_game_duration_seconds).toBeGreaterThanOrEqual(0);

    for (const series of [
      dashboard.json.games_by_month,
      dashboard.json.games_by_quarter,
      dashboard.json.games_by_hour,
    ]) {
      expect(Array.isArray(series)).toBe(true);
      expect(series.length).toBeGreaterThan(0);
      for (const row of series) {
        expect(typeof row.bucket).toBe("string");
        expect(row.games).toBeGreaterThan(0);
        // Not toBeGreaterThan(0): a bucket's games could in principle all have a null
        // player_id (games.player_id is nullable, on delete set null), which count(distinct)
        // wouldn't count — vanishingly unlikely against real data, but not impossible.
        expect(row.dau).toBeGreaterThanOrEqual(0);
      }
    }
    // Today's game must land in exactly one hour-of-day bucket, and that bucket's count
    // is never zero-filled (unlike the daily series) — a real, non-tautological check
    // that the extract(hour ...) grouping actually groups, not just returns 24 empty rows.
    const hourGamesTotal = dashboard.json.games_by_hour.reduce((sum: number, r: any) => sum + r.games, 0);
    expect(hourGamesTotal).toBeGreaterThan(0);

    expect(Array.isArray(dashboard.json.countries)).toBe(true);
    for (const row of dashboard.json.countries) {
      expect(typeof row.country).toBe("string");
      expect(row.games).toBeGreaterThan(0);
    }

    // The API surface a player actually sees never mentions country — it's an admin-only
    // aggregate (ROADMAP Batch 10 item 13's own scope decision).
    expect(game).not.toHaveProperty("country");

    // Admin per-game detail (item 12) also surfaces this same game's country, whatever it
    // resolved to for this request (null under a local/CI run with no edge geo header).
    const detail = await call("GET", `/api/v1/admin/games/${game.game_id}`, undefined, adminHeaders);
    expect(detail.status).toBe(200);
    expect(detail.json.game).toHaveProperty("country");
  }, 15000);

  // --- Batch 10: difficulty rating per word (hardest_words + easy mode) --------
  it("ranks hardest_words by success rate, scoped per wordlist, above the min-attempts floor", async () => {
    if (!ADMIN_TOKEN) return;
    const adminHeaders = { "x-admin-token": ADMIN_TOKEN };

    const dashboard = await call("GET", "/api/v1/admin/dashboard", undefined, adminHeaders);
    expect(dashboard.status).toBe(200);
    expect(Array.isArray(dashboard.json.hardest_words)).toBe(true);

    let previousRate = -1;
    for (const row of dashboard.json.hardest_words) {
      const attempts = row.times_solved + row.times_failed;
      // MIN_ATTEMPTS_FOR_DIFFICULTY (lib/word-stats.ts) — a word tried only once or twice
      // must not appear, however extreme its rate looks.
      expect(attempts).toBeGreaterThanOrEqual(5);
      expect(row.success_rate).toBeGreaterThanOrEqual(0);
      expect(row.success_rate).toBeLessThanOrEqual(1);
      expect(row.success_rate).toBeCloseTo(row.times_solved / attempts, 5);
      expect(typeof row.wordlist).toBe("string");
      // Ascending by success_rate (hardest first).
      expect(row.success_rate).toBeGreaterThanOrEqual(previousRate);
      previousRate = row.success_rate;
    }
  });

  it("accepts an easy-mode game/start and echoes the actual (possibly cold-start-fallback) outcome", async () => {
    const query = new URLSearchParams({ target_length: "7", difficulty: "easy" });
    const { status, json } = await call("POST", `/api/v1/game/start?${query}`);
    expect(status).toBe(200);
    // "easy" can silently fall back to "normal" server-side (lib/game.ts) when no word yet
    // clears EASY_MODE_SUCCESS_THRESHOLD with enough samples — both are a valid, honest
    // outcome; what must not happen is the request failing or the field being absent.
    expect(["easy", "normal"]).toContain(json.difficulty);
    expect(json).not.toHaveProperty("target_word");

    // An unrecognised value is permissive, not a 422 — same convention as other optional
    // query params in this API (e.g. an unrecognised wordlist code is the one exception,
    // since that one is a real lookup key, not a mode flag).
    const garbage = new URLSearchParams({ target_length: "7", difficulty: "extra-hard-please" });
    const garbageResult = await call("POST", `/api/v1/game/start?${garbage}`);
    expect(garbageResult.status).toBe(200);
    expect(garbageResult.json.difficulty).toBe("normal");

    // No difficulty param at all: unchanged pre-existing behaviour, always "normal".
    const plain = await start(7);
    expect(plain.difficulty).toBe("normal");
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
