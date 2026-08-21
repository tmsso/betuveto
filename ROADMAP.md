# Betűvető — Development Roadmap

> **Purpose of this document.** A comprehensive, batch-by-batch implementation plan for
> evolving Betűvető from a single-user demo into a multi-user, multi-language word game
> with an admin interface and mobile distribution.
>
> **Audience.** Each batch is written so it can be handed to an AI coding assistant
> (Sonnet/Opus class) or a junior developer as a self-contained work order: explicit
> scope, acceptance criteria, files to touch, and known gotchas. Batches are ordered by
> dependency — do not skip Batch 0 and 1; almost everything else builds on them.
>
> **Revision (2026-07, PR #7 discussion):** target architecture changed from
> "HF Space + SQLite" to **Vercel + Supabase**. The architectural-decisions section and
> Batches 1, 2, 7 and 8 were rewritten accordingly; Batch 0 still targets the current
> FastAPI app (it closes live security holes and defines the contract for the port).
>
> **Revision (2026-07, Neon switch):** the free Supabase allocation is committed to another
> project, so persistence + auth move from Supabase to **Neon** (serverless Postgres, which
> now bundles a free managed auth service — 60k MAU, Google OAuth). Realtime (Batch 7) moves
> to **Ably**, since neither Neon nor Vercel provides it. Batches 1.1–1.2 shipped on Supabase
> (#9, #10); Batch **1.5** re-points them to Neon. Rationale, free-tier numbers and the
> anonymous-auth caveat are in the architecture decisions below.
>
> **Status legend:** `[ ]` not started · `[~]` in progress · `[x]` done

---

## Current state (as of 2026-07, for orientation)

| Component | Location | Notes |
|---|---|---|
| Backend API | `backend/main.py` | FastAPI, single file, ~320 lines. **One global `GameState` shared by every visitor.** No DB, no auth, no tests. |
| Frontend | `frontend/` | React 19 + Vite 7 + Tailwind 3, PWA plugin configured. All persistence in `localStorage`. Timer, high scores and "failed words" learning live **client-side only**. |
| Word list | `data/magyar-szavak.txt` **and** `backend/data/magyar-szavak.txt` | ~161k Hungarian words, duplicated in two places. |
| Legacy app | `streamlit_app.py`, `game_logic.py`, root `requirements.txt` | Old Streamlit version; logic duplicated from `backend/main.py` and already drifted. |
| Deploy | `.github/workflows/hf_sync.yml`, `backend/Dockerfile` | Push-to-main syncs backend to a Hugging Face Space (port 7860). Frontend deploys via Vercel's GitHub integration (config not in repo). **The target architecture below retires the HF Space in Batch 1.** |

**Core loop today:** backend picks a random word of length 7, sends the scrambled letters
(*and the solution, and the full list of findable words*) to the client; client submits
guesses; score = length²; 3-minute countdown runs in the browser; a "failed word"
reappearance system (weight multipliers) lives in backend process memory and is lost on
every restart.

**Progress since this snapshot:** Batch 0 shipped (#8). Batch 1.1–1.2 (Postgres schema,
wordlist importer, TypeScript Vercel API) shipped on Supabase (#9, #10) and are being
re-pointed to Neon in Batch 1.5. The table above describes the *starting* point, kept for
orientation.

---

## Architectural decisions (locked in for all batches)

These are decided once, here, so individual batches don't re-litigate them:

1. **Hosting: Vercel + Neon (both free tier).** The frontend (static build) and the game
   API (TypeScript serverless functions) live on Vercel — the frontend already deploys
   there. Postgres **and** auth come from one **Neon** free project (Neon Auth is a managed
   Better-Auth service, 60k MAU, Google OAuth built in). Realtime — needed only for
   multiplayer (Batch 7) — comes from **Ably**, because neither Neon nor Vercel provides it.
   The Hugging Face Space and `hf_sync.yml` are retired at the end of Batch 1.
   *Why not Supabase (the prior pick):* its free allocation is committed to another project.
   Neon is a clean swap — same Postgres, keeps the whole relational plan — and actually
   removes Supabase's 7-day-pause chore (Neon scales to zero and resumes on the next query).
   *Why not HF for the backend:* free HF Spaces have ephemeral disks (no DB), ~48 h sleep
   with slow cold starts, and no custom domain (needed for the Android TWA in Batch 9).
2. **Backend language: TypeScript.** Batch 1 ports the ~320-line FastAPI app to Vercel
   API routes (`api/` directory). One-time cost, paid exactly when the backend was due a
   restructure anyway; afterwards the whole stack speaks one language and the platform's
   Auth/Realtime SDKs are first-class. The Python backend (`backend/`) is deleted once
   the port is verified against the Batch 0 contract tests.
3. **Database: Neon Postgres.** Schema lives as plain SQL migrations in `migrations/`,
   applied by a small postgres.js runner (`npm run db:migrate`) — there is no Supabase CLI.
   Serverless functions query through **postgres.js** against Neon's pooled connection
   string (`prepare:false`, since the pooler is PgBouncer transaction-mode) — no driver swap
   was needed from the Supabase build, which already used postgres.js. (Neon's
   `@neondatabase/serverless` HTTP driver is an option if per-invocation connection setup
   ever becomes a bottleneck.) **The security boundary is that the client never receives DB
   credentials at all** — every query runs in a Vercel function holding `DATABASE_URL`, so no
   table of answers is ever client-readable. (Postgres RLS is therefore optional here —
   defense-in-depth, not load-bearing as it was under Supabase's anon key.)
4. **Identity: anonymous-first via a signed device cookie; Neon Auth reserved for Google.**
   **Confirmed 2026-07-24:** Neon's managed Better Auth does not support anonymous sessions
   (the `anonymous` Better Auth plugin isn't in Neon's supported-plugin list or roadmap).
   So Batch 2 mints its own signed, HTTP-only anonymous cookie for device identity — nobody
   is ever forced to sign in to play — and Neon Auth is reserved for the Google OAuth
   *identity link* in Batch 8 (an upgrade for cross-device continuity, never a login wall).
5. **Server-authoritative game state.** After Batch 1, the client never receives the
   target word or the solution list during an active game, and the server enforces the
   timer and computes all scores. Serverless statelessness makes this structural: there
   is no process memory to lean on — all game state lives in Postgres.
6. **Language/wordlist model:** every game row references a `wordlist_id`; word data
   lives in a `words` table, not in flat files at runtime. Flat files remain the *import*
   format. Each word row stores a `signature` (its letters sorted alphabetically,
   indexed): the findable words for a board are exactly those whose signature is a
   multiset-subset of the board's letters — enumerable as ~100 signature combinations for
   a 7-letter board — so possible-words is one indexed `WHERE signature IN (...)` query
   instead of a 161k-row scan per game start (which would eat the serverless time budget).
7. **Multiplayer transport: Ably** (free tier: 6M messages/month, 200 concurrent
   connections), room-based, co-op. Vercel functions cannot host WebSocket servers and Neon
   has no realtime, so Ably fills the gap — guesses still go over REST, and the API route
   publishes progress to the room channel. Only introduced in Batch 7.
8. **Android: PWA → Trusted Web Activity (Bubblewrap)**, not a native rewrite. See the
   challenge notes in Batch 9.
9. **API versioning:** all new endpoints under `/api/v1/`; keep old paths as thin aliases
   until the frontend is migrated, then delete them.
10. **Free-tier operating notes (know these, don't fight them):**
    - Neon free tier: 0.5 GB storage, 100 compute-hours/month, scale-to-zero with near-
      instant resume, up to 100 projects. **No inactivity pause/delete** — so, unlike
      Supabase, no keep-alive cron is needed.
    - Vercel Hobby is **non-commercial** — fine for a free game; revisit on monetisation.
    - The function timeout (10 s default) is the compute budget — hence the signature
      design in (6); no endpoint may scan the full wordlist per request.
    - Ably free tier (Batch 7): 6M messages/month, 200 concurrent connections — ample at
      hobby scale, but keep messages coarse (progress updates, never keystrokes).

---

## Batch 0 — Bug & security fixes (do first, no new features)

*Goal: the existing single-player game becomes correct, honest and safe to expose
publicly — without changing its feature set. Everything here is independently shippable.*

*Note: these fixes target the current FastAPI app even though Batch 1 ports it to
TypeScript — they close live security holes now and, together with 0.10's tests, define
the behavioural contract the port must preserve. Keep each fix minimal accordingly; skip
container/infra polish that the migration makes moot (flagged per item).*

### 0.1 `[x]` Stop leaking the solution to the client
- `POST /api/game/start` returns `target_word` in its response (`backend/main.py`,
  `start_new_game`) — anyone with DevTools sees the answer instantly.
- `GET /api/game/state` returns `current_word`.
- `GET /api/game/possible_words` returns the **full solution list at game start**; the
  frontend only needs the *count* while playing and the word list only *after* the game ends.
- **Fix:** remove `target_word`/`current_word` from live responses; split possible-words
  into `GET /api/game/possible_words/count` (allowed any time) and the full list only
  when `game_active == False`. Frontend: track "was this word failed before" via a
  server-set flag (`is_previously_failed` already exists) instead of comparing against
  `target_word`; fetch the full remaining-words list only on game end.
- **Accept:** with a game in progress, no API response contains the target word or any
  unfound word.
- **`is_previously_failed` removed 2026-07-30** (Batch 10, product decision — see item 3's
  updated note): per-word failure history is no longer shown to players at all, so the
  flag this acceptance criterion built on no longer exists. `game/start` never leaked the
  target word to begin with either way; this item's own accept condition still holds.

### 0.2 `[x]` Fix the shared-global-state hazard (interim mitigation)
- One `GameState()` instance serves all clients: two simultaneous visitors overwrite each
  other's word, and `POST /api/game/reset` lets anyone kill anyone's game. The real fix
  (per-session games) is Batch 1; the *interim* fix is to key game state by a
  server-generated `game_id` (random UUID returned by `/start`, required by
  `/guess`, `/rescramble`, `/state`), stored in an in-process dict with a TTL sweep
  (games expire 30 min after start). This is ~60 lines and removes the worst hazard now.
- Also add a `threading.Lock`/per-game lock around mutations — FastAPI runs handlers
  concurrently.
- **Accept:** two browsers can play different games at the same time without interfering;
  a `guess` with an unknown/expired `game_id` returns 404.

### 0.3 `[x]` CORS misconfiguration
- `allow_origins=["*"]` together with `allow_credentials=True` is an invalid and unsafe
  combination (browsers reject it the moment credentials actually matter).
- **Fix:** read allowed origins from env (`CORS_ORIGINS`, comma-separated; default
  `http://localhost:5173`). Keep `allow_credentials=True`.
- **Accept:** requests from unlisted origins are rejected; local dev still works.

### 0.4 `[x]` Enforce the timer server-side
- The 180 s countdown exists only in React state; the API happily scores guesses forever.
- **Fix:** store `started_at` and `duration_seconds` per game; `/guess` rejects (with a
  clear `game_ended: true` payload) once expired. Return `ends_at` (epoch seconds) from
  `/start` so the client clock just renders it — this also fixes drift on tab-sleep.
- **Accept:** a guess sent 181 s after start scores 0 and reports the game ended,
  regardless of client behaviour.

### 0.5 `[x]` Replace the "1-letter guess = reveal" hack
- `guess_word` treats any single-character guess as "give up and reveal" — an accidental
  single letter + Enter silently ends the game and marks the word as failed.
- **Fix:** dedicated `POST /api/game/give_up` endpoint; single-character guesses become a
  normal "too short" validation error (min length 3, see 0.6). Frontend: an explicit
  "Feladom" (give up) button behind a confirm.
- **Accept:** no guess input can end the game; give-up works via its own endpoint.

### 0.6 `[x]` Minimum word length inconsistency (2 vs 3)
- `get_possible_words` counts words of length ≥ 3, but `/guess` accepts and scores any
  dictionary word ≥ 2 (frontend blocks only length < 2). Finding a valid 2-letter word
  breaks the found/total counter and the "all words found" bonus logic.
- **Fix:** single `MIN_WORD_LENGTH = 3` constant enforced in `/guess` and reflected in the
  frontend; message "Legalább 3 betűs szót adj meg."
- **Accept:** 2-letter guesses are rejected; `foundWords.length` can never exceed
  `possibleWordsCount`.

### 0.7 `[x]` Validate `target_length` input
- `POST /api/game/start?target_length=...` accepts any int (also unbounded via the JSON
  body variant). **Fix:** FastAPI `Query(ge=5, le=10, default=7)` / pydantic
  `Field(ge=5, le=10)` — this also pre-builds the contract for Batch 2's length option.

### 0.8 `[x]` Frontend robustness fixes
- `JSON.parse(localStorage.getItem(...))` in `App.jsx` (mount effect) has no try/catch —
  one corrupted value white-screens the app. Wrap in try/catch, fall back to `[]`.
- `startGame()` fallback in `api/client.ts` fires a *second* `/start` if the first
  returned non-OK — with the query-param endpoint working, delete the `/api/game/start/body`
  compatibility fallback (and the backend twin endpoint) entirely.
- `is_seven_letter` (backend) is hardcoded to 7; use `len(word) == len(current_word)`
  ("found the target-length word") so it survives the word-length option. Rename the
  response field to `is_full_length`.
- `handleSubmit`'s `useCallback` closes over `recordFailedWord` without listing it —
  convert `recordFailedWord` to `useCallback` and add it to the deps (currently a
  stale-closure landmine for future edits).
- **Accept:** `npm run lint` passes with react-hooks rules satisfied; corrupted
  localStorage does not crash the app.

### 0.9 `[x]` Repository hygiene
- Delete the duplicated wordlist: keep `data/magyar-szavak.txt` as the single source; the
  Dockerfile/HF workflow already copy `data/` in — make `backend/data/` go away (adjust
  `WORDLIST_PATH` default and `hf_sync.yml` if needed).
- Remove the legacy Streamlit app (`streamlit_app.py`, `game_logic.py`, root
  `requirements.txt`, Streamlit vars in `.env.example`) — it duplicates game logic that
  has already drifted. If sentimental, move to `legacy/` with a README note; do not keep
  it importable.
- Rewrite `README.md`: it currently claims "React 22", "OpenClaw AI integration" and cuts
  off mid-sentence at "## Development Setup". Document: what the game is, how to run dev
  (`run_dev.sh`), how deploy works, where the wordlist comes from (and its licence — verify!).
- Dockerfile hardening: **skip** — the HF Space and its Dockerfile are retired in
  Batch 1 (see architecture decisions); don't invest in the container.
- Add `LICENSE` file (decide: MIT for code; document wordlist licence separately).

### 0.10 `[x]` Minimal test harness + CI
- pytest is already in `backend/requirements.txt` but there are zero tests.
- **Add:** `backend/tests/` with FastAPI `TestClient` covering: start→guess→score flow,
  can-form logic (including Hungarian accented letters ÁÉÍÓÖŐÚÜŰ and double letters),
  timer expiry, invalid `target_length`, unknown `game_id`. A GitHub Actions workflow
  (`ci.yml`) running `pytest` + `npm run lint` + `npm run build` on every PR.
- Write the tests against the **HTTP surface** (requests/responses), not Python
  internals: they double as the behavioural contract for the Batch 1 TypeScript port,
  where they get translated to Vitest and must pass against the new API unchanged in meaning.
- **Accept:** CI is green and required; every later batch adds tests to this harness.

---

## Batch 1 — Foundations: port to Vercel + Neon

*Goal: the load-bearing migration everything else depends on. No user-visible features,
but after this batch the app runs on the target architecture with real persistence, and
the HF Space is gone. Requires Batch 0 (especially 0.10's contract tests) to be done first.*

*Note: 1.1–1.2 were first built on Supabase (#9, #10); 1.5 re-points persistence to Neon.
The schema and API logic are Postgres-generic and carry over — only the driver, migration
runner, auth wiring and env vars change.*

### 1.1 `[x]` Postgres schema + wordlist importer  _(built on Supabase in #9; DB re-pointed to Neon in 1.5)_
- Commit SQL migrations (in `supabase/migrations/` as shipped; moved to `migrations/` in 1.5) for:
  - `players(id UUID pk references auth.users, created_at, display_name nullable, is_admin bool default false, preferred_length int nullable)`
  - `games(id UUID pk, player_id fk nullable, wordlist_id fk, target_word, target_length, started_at, ends_at, ended_at nullable, final_score, found_count, possible_count, status enum[active,finished,abandoned,given_up])`
  - `game_guesses(id, game_id fk, word, correct bool, score, created_at)` — needed later for review/anti-cheat and "words found" history.
  - `word_stats(player_id, word, times_failed, times_solved, last_failed_game_seq)` — replaces the in-memory `failed_words` dict, per player.
  - `wordlists(id, code e.g. 'hu', name, active)` and `words(id, wordlist_id, word, length, signature, active bool default true, source enum[original,suggested], created_at)` — index on `(wordlist_id, signature)` and `(wordlist_id, length, active)`.
- **Security boundary: the client never gets DB credentials** — all access is via the API
  functions holding `DATABASE_URL`. (Under Supabase this was enforced with RLS deny-all +
  service-role key; on Neon the client simply never connects to Postgres, so RLS is optional
  hardening.)
- Importer script `scripts/import-wordlist.ts` loading `data/magyar-szavak.txt` into
  `words` (idempotent batch upserts), computing `signature` (sorted letters) per word.
- **Gotcha for the implementer:** normalise words to `NFC` + uppercase on import **and**
  on every guess (`word.normalize('NFC').toUpperCase()`), so composed vs decomposed `Á`
  compare equal; Hungarian uppercasing is locale-safe in JS but be explicit about NFC.
- **Bug found and fixed 2026-07-30:** `normalizeWord()` only ever checked length, never
  content — hyphenated compounds and multi-word phrases in the Hungarian source
  dictionary ("ADÓ-VEVŐ", "BIMBÓS KEL") were imported as ordinary active words (2,882 of
  them, live in production, spanning every playable board length). Any one could be
  picked as a game's target, scrambling a hyphen/space onto the board that the on-screen
  keyboard has no key for — an unplayable puzzle. Fixed with a Unicode-letters-only check
  (`\p{L}`, not a hardcoded per-language charset, so a genuine loanword letter like
  "DOPPELGÄNGER"'s Ä still passes) in `normalizeWord()`, plus `migrations/0011` to purge
  the words already imported before the fix. `scripts/verify-db.ts` now asserts zero
  non-letter words as a standing invariant.

### 1.2 `[x]` Port the API to TypeScript Vercel functions  _(DB driver swapped to Neon in 1.5)_
- Recreate the FastAPI endpoints as Vercel API routes under `/api/v1/` (thin aliases at
  the old paths until 1.3 lands). Same behaviour as the post-Batch-0 app; game state
  lives in the `games` table — there is no in-process state at all.
- Possible-words is computed **once at game start** via the signature-subset query
  (enumerate multiset subsets of the board's letters, length ≥ 3, one `WHERE signature
  IN (...)`) and stored on the game row (`possible_count`; the word list itself can be
  recomputed at game end — do not send it to the client while active, per 0.1).
- Guess check = single indexed lookup in `words` (active only), then the can-form check
  against the game's letters, then insert into `game_guesses` — all in the function.
- Port the Batch 0 pytest contract tests to Vitest; they must pass unchanged in meaning.
- **Accept:** full game flow works against a Vercel preview deployment; a redeploy
  mid-game loses nothing.

### 1.3 `[x]` Frontend cutover + retire the Python stack
- Frontend and API are same-origin: dropped `VITE_API_BASE_URL` and the Vite dev proxy in
  favour of `vercel dev` (`vercel.json` gained a `devCommand` that runs the Vite dev server
  and lets `vercel dev` proxy to it; `run_dev.sh` is now just `exec npx vercel dev`).
  Verified locally: `/api/v1/health`, `/api/words/count`, and the frontend all serve
  correctly from one `vercel dev` origin. The `/api/game/start/body` fallback was already
  gone (0.8).
- Deleted `backend/` and `.github/workflows/hf_sync.yml` (CI's backend pytest job dropped
  too). Updated README/`frontend/README.md`/`.env.example` for the new stack.
- **Not done by this PR:** the Hugging Face Space itself still exists on HF's side — this
  repo no longer pushes to it, but deleting the Space is a separate action on that account.

### 1.4 `[x]` Ops & backups
- **No keep-alive needed** — Neon has no inactivity pause; it scales to zero and resumes on
  the next query. (This item existed only for Supabase's 7-day pause; dropped.)
- `/api/v1/health` (one cheap `select 1`) shipped, covered by the contract suite, verified
  live against a Neon-backed preview.
- Backups: **intentionally deferred**, per this item's own condition — there's no score
  data yet (Batch 2 identity hasn't shipped). Revisit the monthly `pg_dump` GitHub Actions
  backup once real player/game data exists to protect. (The earlier blocker — the push
  token lacking the `workflow` scope — is resolved; the token now has it.)
- **Backup shipped 2026-07-25** (unblocked: Batch 2 identity has since landed, so there's
  real player data to protect): `.github/workflows/backup.yml`, monthly `pg_dump` against
  the Neon pooled connection string, uploaded as a 90-day workflow artifact. Pins
  `postgresql-client-18` from the PGDG apt repo rather than Ubuntu's default (checked live:
  the Neon project is on Postgres 18, and a mismatched `pg_dump` major hard-errors).
  **Needs one manual step before it's live:** add a `DATABASE_URL` repository secret
  (Settings → Secrets and variables → Actions) — a workflow can't create its own secret.
  Use `workflow_dispatch` to run it once by hand and confirm before trusting the cron.

### 1.5 `[x]` Re-point persistence from Supabase to Neon
*The old Supabase DB was paused and unrecoverable, so this was a from-scratch build on
Neon — nothing to migrate data-wise.*

**Prep:**
- From-scratch schema `migrations/0001_init.sql` (consolidates the two Supabase-era
  migrations), de-Supabased: `players.id` is a standalone UUID (no `auth.users` FK; Batch 2
  links it to Neon Auth), and RLS is dropped (optional on Neon — see decision 3).
- `scripts/migrate.ts` + `npm run db:migrate`: a postgres.js runner with a
  `schema_migrations` tracking table. **No driver swap** — the DB layer already uses
  `postgres` (postgres.js), which talks to Neon's pooled endpoint directly; `prepare:false`
  stays correct (Neon's pooler is also PgBouncer transaction-mode).
- De-Supabased the tooling: removed `supabase/`, the `supabase` CLI dependency and script;
  re-pointed `import-wordlist.ts` / `verify-db.ts` (dropped the RLS check) and the `lib/db.ts`
  comments; updated `.env.example` (single `DATABASE_URL`, no `SUPABASE_*`) + README.

**Apply — done 2026-07-24:**
- Neon project created (`eu-central-1`); pooled connection string set as `DATABASE_URL`
  locally and as `DATABASE_URL` on Vercel (Production + Preview + Development).
- `npm run db:migrate` → `npm run db:import` (155,107 words, same count as the Supabase
  build) → `npm run db:verify` (schema, RLS-dropped tables, and the signature-subset index
  scan all green).
- **Accept, verified:** `db:verify` passed, and the Batch 0/1.2 HTTP contract suite (37
  tests) passed against a live Vercel preview backed by Neon
  (`API_BASE_URL=<preview> VERCEL_AUTOMATION_BYPASS_SECRET=<secret> npm test`) — same
  deployment-protection-bypass gotcha as the Supabase round applied here too.

---

## Batch 2 — Player identity (anonymous), server high scores, word-length option

### 2.1 `[x]` Anonymous identity via a signed cookie (Neon Auth reserved for Google, Batch 8)
- **Confirmed 2026-07-24 (see architecture decision 4): Neon's managed Better Auth does not
  support anonymous sessions.** Its documented supported-plugin list (Admin, Email OTP, JWT,
  Magic Link, Organization, Open API, Phone Number) does not include Better Auth's
  `anonymous` plugin, and it isn't on Neon's roadmap either (only "other plugins based on
  demand"). Note: Neon's `@neondatabase/auth` SDK has an unrelated `allowAnonymous` option —
  that issues anonymous JWTs for RLS-based *public read access*, not a persistent per-device
  user account with an upgrade path, so it isn't a substitute here.
- On first visit, the API mints a signed, HTTP-only anonymous cookie (device identity, like
  a save file) and resolves or creates the matching `players` row from it. No UI, no consent
  friction. Neon Auth is reserved for the Google OAuth upgrade in Batch 8.
- **Shipped 2026-07-24:** `lib/auth.ts` (UUID + HMAC-SHA256, timing-safe verification) wired
  into `POST /api/game/start` — resolves an existing `bv_anon` cookie or mints a fresh one,
  creates the `players` row on first mint, threads `player_id` into the `games` insert, and
  echoes `player_id` in the response (not the signed token itself). Verified live: a
  two-request contract test proves the same `player_id` comes back on a repeat visit with
  the cookie. **Not yet done** — deferred to when it's needed: the optional display-name
  input below, and reading/creating identity anywhere other than game start (2.2/3.3 will
  need it there too).
- Optional display name: small "name yourself" input (stored on `players.display_name`,
  max 20 chars, strip/validate; profanity filtering is out of scope — admin can edit in Batch 5).
- **Challenge to the original idea:** *don't start with Google OAuth.* It adds a consent
  screen, GCP project and redirect-URI config for zero gameplay value at this stage.
  Anonymous identity delivers per-player scores/stats immediately; OAuth arrives in
  Batch 8 as a ~10-line *identity link* on the same user ("keep my progress across devices").

### 2.2 `[x]` Server-side high scores
- `GET /api/v1/scores/top?length=7&wordlist=hu&period=all|week|day` → top N
  (score, display_name, date). Written automatically when a game finishes (server
  computes final score — client totals are never trusted).
- Frontend: high-score panel (there is already a hidden/commented block in `App.jsx`);
  show global top 10 + "your best". Keep the existing localStorage scores as a fallback
  display until this ships, then delete that code.
- **Anti-cheat baseline (cheap, do now):** scores only from server-recorded guesses;
  rate-limit `/guess` (e.g. 3/s per player — cheapest implementation: count the player's
  `game_guesses` rows from the last few seconds before accepting) so dictionary-dump
  bots don't own the board. Perfect anti-cheat is explicitly out of scope.
- **Shipped 2026-07-24:** `GET /api/v1/scores/top` + `lib/scores.ts`, top 10 + `your_best`
  (identity resolved server-side from the signed cookie, never a client-supplied
  `player_id` — prevents guessing another player's best). Reuses `games_leaderboard_idx`
  as-is. Frontend high-score panel wired up; localStorage top-3 kept as an offline/error
  fallback. **Not yet done — deferred on purpose:** the anti-cheat rate-limit bullet above
  (kept `guess()` free for the same-round completion-bonus work below); a period selector
  in the UI (`period` is implemented and tested on the API, just not exposed yet).
- **Rate limit shipped 2026-07-25** (unblocked: the completion-bonus work above has since
  landed): 3 correct guesses/second/player in `guess()`, checked *after* the guess is
  already committed rather than before. That ordering wasn't a style choice — a
  concurrency test during this batch (`Promise.all` firing 8 correct guesses on one board
  at once) showed the naive check-then-insert version doing nothing at all: every
  concurrent request read "0 so far" before any had committed, so all 8 passed. Counting
  post-insert (and deleting the offending row on rejection) means every sibling's commit
  is visible by the time each one checks, so the surviving rate really is bounded even
  under true concurrency. The same test also surfaced a pre-existing, unrelated bug it
  happened to make visible: `found_count = found_count + 1` was computed in JS from a
  stale pre-request read, so concurrent guesses on the same board could overwrite each
  other's increment. Fixed alongside (not introduced by this item) by making the
  increment — and the persisted `final_score` on the game-ending guess — a single atomic
  `UPDATE ... RETURNING`, sourced from a fresh sum over `game_guesses`/`game_hints` rather
  than the JS-held pre-request numbers.

### 2.3 `[x]` Word length option (5–10)
- Backend already parametrised after 0.7. Frontend: a length selector on the
  new-game modal/start screen (default 7, persisted per player in DB `players.preferred_length`).
- High scores are **per length** (a 10-letter board yields far more points — never mix boards).
- Timer scales with length: suggest `duration = 120 + 15 × (length − 5)` seconds
  (config values, admin-editable in Batch 5).
- **Accept:** each length 5–10 has words available (verify against the wordlist and hide
  lengths with < 500 candidate words), separate leaderboards render correctly.
- **Shipped 2026-07-24:** length selector (5–10, default 7) wired to game start; timer
  ceiling now `durationForLength` (`120 + 15 × (length − 5)`); `players.preferred_length`
  persisted via `GET`/`PATCH /api/v1/me/preferences`; selector only offers lengths with
  ≥500 candidate words. **Visible behaviour change riding along:** default (length-7) game
  duration dropped from 180s to 150s — this is exactly the roadmap formula above, not a
  bug, but worth knowing if it looks surprising later.

---

## Batch 3 — Gameplay depth: hints, totals & bonus, stats

### 3.1 `[x]` Hint option (at a cost)
- Design (keep it simple, one hint type first):
  - `POST /api/v1/game/{id}/hint` reveals the **first letter of one random unfound word**
    (prefer longer words). Response: `{letter, position: 1, word_length, cost}`.
  - Cost: deduct `hint_cost` points (default 10, config) from the running score; floor at 0.
    Alternative costs (time penalty, limited hint count) are config knobs, not new code paths.
  - Record hints in a `game_hints` table (needed for fair leaderboards).
- Leaderboard policy: hinted games still count, but show a 💡 marker; keep it simple —
  a separate "pure" board is a config toggle for later, not a launch requirement.
- Frontend: hint button with cost label, disabled when score < cost or no unfound words.
- **Shipped 2026-07-25:** `game_hints` migration (`migrations/0002_hints_and_reports.sql`),
  `lib/hints.ts`'s `useHint()` (plain `HINT_COST = 10` constant, per 3.2's precedent —
  becomes admin-editable in Batch 5), `POST /api/v1/game/{id}/hint`. Cost is deducted by
  keeping `raw_guess_score`/`hint_cost_total` as separate components and flooring at 0 at
  every point of use (`lib/game.ts`'s `effectiveScore`) rather than as one pre-floored
  column — a single floored value would let the score visibly jump back down on the next
  guess once hints had driven it to 0 (`max(0,x)+s ≠ max(0,x+s)` for `x<0`). Leaderboard
  (`lib/scores.ts`) gained a `hinted` boolean per entry. Frontend: hint button (disabled
  once every word is found; **not** disabled by score, on purpose — a first pass also
  disabled it whenever the running score was under the hint cost, which is *every* fresh
  game at 0 points, so the button was unusable until the player had already found
  something. The browser check against the preview deployment caught this: the button
  never became clickable on a new game. Removed — the server's own floor-at-0 already
  does the job that condition was trying to). A `hintPenalty` state is subtracted from
  the client's own locally-summed score at display time (the client never learns the
  server's total mid-game — same pre-existing local-score-computation shape 3.2 already
  flagged), and a toast shows the revealed letter.

### 3.2 `[x]` Total word count + completion bonus (server-side)
- The client already shows found/total and grants `+timeLeft` bonus — but computes it
  locally. Move to server: when `found_count == possible_count`, server ends the game and
  adds `remaining_seconds × completion_multiplier` (default 1) bonus. Return the final
  breakdown so the UI can celebrate honestly.
- Show possible-count per game start (from 0.1's count endpoint).
- **Shipped 2026-07-24, pulled forward out of order** (built alongside Batch 2's
  remainder, ahead of 3.1/3.3): `guess()`'s existing `gameEnded` block (which already set
  `status='finished'`/`final_score` on a full clear) now adds
  `remaining_seconds × COMPLETION_BONUS_MULTIPLIER` (plain constant `1` for now — Batch 5
  makes it admin-editable) and returns a `completion_bonus` field; the frontend celebration
  now displays the server's number instead of its own local `+timeLeft` calculation.
- **Pre-existing issue surfaced, not fixed here (out of scope for this item):** the
  frontend's own score display uses JS string length for a word, which can diverge from
  the server's Hungarian-aware letter count for digraphs (`cs`, `sz`, …) — whoever next
  touches score display should know this predates 3.2 and isn't something it introduced.

### 3.3 `[x]` Player stats page (small, high-value)
- `GET /api/v1/me/stats`: games played, average score per length, longest word found,
  completion rate, personal failed-words list (server-side now, from `word_stats` —
  replaces the localStorage "Előzmények" feature; migrate then delete the local version).
- **Shipped 2026-07-25:** `lib/word-stats.ts` — this is where `word_stats` first gets
  *written* (it existed as a table since Batch 1.1 but nothing populated it until now):
  `recordSolved`/`recordFailed`, called from `lib/game.ts` at every terminal transition —
  the target word found (`guess()`), a full timeout, or `give_up()`. The timeout case
  needed a real fix, not just a hook: the frontend never calls `getGameState`, it calls
  `getPossibleWords()` the instant its own countdown hits zero, so that's where a
  stale-`active` row actually gets finalized in practice (alongside `guess()` and
  `give_up()`) — extracted into a shared `finalizeExpiry` so all three agree. `GET
  /api/v1/me/stats` reads a no-identity request as an empty sheet (same convention as
  `lib/players.ts`'s `getPreferredLength`), not an error. Riding along: `is_previously_failed`
  (returned since Batch 0.1, always hardcoded `false` before this) is now a real lookup
  against `word_stats`. **Migration decision (per discussion):** no one-shot migration of
  existing localStorage failed-words data — dropped in favour of starting the server-side
  list fresh, since anonymous-cookie identity (Batch 2.1) is new enough that little of
  the old local history is meaningfully tied to a durable player anyway. Frontend: the old
  "Előzmények" panel is gone, replaced by a "📊 Statisztikám" panel (games played,
  completion rate, avg score per length, longest word, failed words with counts).
  **Revised 2026-07-30** (Batch 10, product decision — see item 3's updated note): the
  per-word failed-words list and the `is_previously_failed` flag were both removed from
  this endpoint/panel entirely — this isn't an educational/practice game, so no per-word
  history is shown to players. `longest_word_found` stays in the response (not currently
  displayed, kept as a candidate data source for a future fun-fact highlight) but the
  panel is otherwise just games played / completion rate / avg score by length now.

---

## Batch 4 — Community word curation (flag wrong / suggest missing)

*Rationale: with a 161k-word scraped list, curation is the highest-leverage quality
feature for a Hungarian word game. Ship it before the admin UI so the queue has content.*

### 4.1 `[x]` Flag an accepted word as wrong
- In the found-words chips and end-of-game "missing words" list, add a small ⚑ on each
  word → `POST /api/v1/words/{word_id}/report {reason?: string}` (player-authenticated,
  one report per player per word).
- Table `word_reports(id, word_id, player_id, reason, created_at, status enum[open,accepted,rejected])`.
- **Auto-inactivation rule (per the product idea):** when an active word accrues
  **≥ 2 open reports from distinct players**, set `words.active = false` and it stops
  appearing in future games/possible-word lists immediately; it stays flagged for
  admin decision (reactivate or delete) in Batch 5. Target words of *active* games are
  not yanked mid-game.
- **Challenge — email vs DB:** skip auto-email. Email infra (SMTP creds, deliverability,
  spam folders) is pure overhead when Batch 5 gives the admin a queue with a badge count.
  If a nudge is wanted later, a weekly digest cron is a one-day add-on — record
  everything in DB now, decide about email never.
- **Shipped 2026-07-25, one deliberate deviation from the spec above:** the endpoint is
  `POST /api/v1/words/report {word, wordlist?, reason?}` rather than path-based
  `{word_id}/report` — the frontend never receives word ids anywhere in the existing API
  surface (found-word chips, possible-word lists, and guesses are all plain text), so
  routing by id would mean threading ids through every response just for this one
  feature. `lib/word-reports.ts` resolves the id server-side from `{wordlist, word}`
  instead. `word_reports` migration in `migrations/0002_hints_and_reports.sql`;
  auto-inactivation counts `count(distinct player_id)` so one player double-reporting
  can't retire a word alone. `lib/game.ts`'s `guess()` keeps a game's own target word
  guessable even if it gets deactivated mid-game by this mechanism (an explicit exception
  for `word = game.target_word`); a *non-target* findable word deactivating mid-game is
  not specially handled (documented as an accepted, rare edge case in that function).
  Frontend: a ⚑ button on both found-word chips and the end-of-game missing-words list,
  simplified to no reason-collection UI for v1 (the API accepts one, just not surfaced).

### 4.2 `[x]` Suggest a missing word
- After a rejected guess ("Nincs ilyen szó"), offer "Szerinted létező szó? Beküldöm" →
  `POST /api/v1/words/suggest {word, wordlist?}`.
- Inserts into `words` with `active=false, source='suggested'` + a row in
  `word_suggestions(word_id, player_id, created_at, status)`. Validation: length 3–15,
  Hungarian alphabet only, not already present (case/NFC-normalised).
- Rate-limit: max 10 suggestions/player/day.
- Optional delight (deferred, not done): when an admin approves a suggestion, the
  suggesting player sees a "your word was added!" toast on next visit — revisit once
  Batch 5's review queue exists to actually approve anything.
- **Shipped 2026-07-27:** `lib/word-suggestions.ts`'s `suggestWord()`, wired as the
  `words` dispatcher's new `suggest` action (the api/v1/[...path].ts catch-all from the
  dispatcher-consolidation prep work). Deviates from a literal reading of "not already
  present" being an error: mirrors 4.1's report endpoint in treating "already in the
  dictionary" *and* "already suggested by someone else" as the same non-error `{suggested:
  true, already_present: true}` outcome (200), not a 409 — the player tried to help either
  way, so there's nothing to flag as wrong. Rate limit uses the same insert-then-count-
  then-undo-if-over shape as 2.2's guess rate limit, for the same concurrency-safety
  reason. Frontend: a small "Szerinted létező szó? Beküldöm" prompt appears under the
  guess input after a rejected guess, replaced by a brief non-error-styled thanks
  confirmation on submit (deliberately not reusing the red shake error toast — a
  confirmation isn't a mistake to flag).

---

## Batch 5 — Admin interface

### 5.1 `[x]` Admin auth & shell
- `players.is_admin` flag (set manually in DB for the first admin — Neon's SQL editor / any
  Postgres GUI covers emergency data fixes until this batch ships).
  Admin endpoints under `/api/v1/admin/*` guarded by a check on the flag; **admins must
  log in via Google OAuth once Batch 8 lands — until then, a long random admin token in
  env (`ADMIN_TOKEN`) sent as a header is acceptable and simple.**
- UI: a separate route in the existing React app (`/admin`), not a separate deployment.
  Plain tables and forms; do not add a component library for this.
- **Shipped 2026-07-27:** gates on `ADMIN_TOKEN` alone (`lib/admin.ts`, timing-safe
  compare, sent as `x-admin-token`) — `players.is_admin` stays unused until Batch 8 makes
  it per-authenticated-player; there's no admin *session* concept for it to gate yet.
  `requireAdmin()` wraps every `/api/v1/admin/*` route in the dispatcher at one point, so
  a future route can't add itself without the check. No `react-router`: the frontend had
  zero routing before this, and `/` vs `/admin` is one static split with no nested or
  dynamic routes, so `main.jsx` checks `window.location.pathname` directly — tabs inside
  the admin panel are component state, not sub-routes. `AdminApp.jsx`: a token-entry form
  (stored in this browser's `localStorage`, never sent anywhere but the API) gating a
  read-only view of 5.2 item 1's word review queue (open reports + suggestions), pulled
  forward into this PR so the shell has real data to show rather than a placeholder page.

### 5.2 `[x]` Admin features (in priority order)
1. `[x]` **Word review queue:** open reports and suggestions; approve/reject; reactivate
   auto-inactivated words; edit/delete words; search the wordlist.
   **Shipped 2026-07-27** (`lib/admin-queue.ts`): listing (5.1) plus accept/reject on
   reports (accept deactivates the word and closes its open reports; reject reactivates
   it and closes them — both in one transaction), a standalone `reactivate` endpoint
   independent of report status, and approve/reject on suggestions (approve activates the
   word; reject leaves it inactive). Re-resolving an already-closed report/suggestion is a
   409, not a silent no-op.
   **User-tested live, one fix applied:** the reports table's first button labels read as
   status descriptions rather than actions (unlike the suggestions table's clear
   first-person verbs) — relabeled with an explicit tooltip; backend itself was confirmed
   correct throughout via direct API calls. **Raised by the user during this testing, not
   yet actioned:** the shared `ADMIN_TOKEN` header is a burden to retrieve/rotate for
   day-to-day use — candidate for email+passkey or magic-link admin login (Neon Auth
   supports Magic Link; see architecture decision 4), which would mean pulling some of
   Batch 8's Neon Auth integration forward for admins specifically, ahead of player-facing
   Google OAuth. **Confirmed 2026-07-28:** Managed Better Auth + the Magic Link plugin are
   now enabled in the Neon console (10-minute link expiry, new-user signup allowed) —
   still not scoped/built, and not yet confirmed whether that also fully provisions
   Better Auth itself; a design discussion for a future session, not started this one.

   **Design sketch, 2026-07-28 (design only — not built; adds a new auth capability, so
   implementation needs a separate explicit go-ahead):**
   - **Scope boundary vs. Batch 8:** this pulls forward *only* the admin slice of Neon
     Auth. Add a nullable `players.auth_user_id text unique` column now (small migration),
     populated only for the handful of admin rows; Batch 8 later reuses the same column
     for every player via Google OAuth + the anonymous-merge rule already specified there.
     Naming it generically now (not `admin_auth_user_id`) avoids a rename later.
   - **Admin accounts stay manually provisioned**, same bootstrap pattern as `is_admin`
     (5.1: "set manually in DB for the first admin"). No self-service admin signup: an
     admin's `auth_user_id` is set by direct SQL against Neon Auth's user id after their
     first magic-link sign-in, not by any in-app flow. Neon Auth's own "new-user signup
     allowed" toggle only controls who can *authenticate* — it doesn't grant admin
     capability by itself (see next point), so it can stay on without being a privilege risk.
   - **Authentication vs. authorization stay separate**, the same shape Batch 8 already
     uses: Neon Auth proves "this session owns this email"; the app's own check (`is_admin`
     on the `players` row linked via `auth_user_id`) is what actually gates
     `/api/v1/admin/*`. Anyone can complete a magic link; only a linked, flagged row can
     act as admin.
   - **Transition, not a cutover:** keep `ADMIN_TOKEN` valid in parallel with the new
     session check in `lib/admin.ts` (`isAdminAuthorized` accepts either) until the new
     flow is confirmed working end-to-end — a same-day atomic cutover risks locking out
     the only admin if the new mechanism has an edge case nobody's hit yet. Retire
     `ADMIN_TOKEN` in a follow-up PR once that's confirmed.
   - **Resolved 2026-07-28 (checked Neon's docs directly):** the console toggle already
     exposes a usable hosted flow — no need to run a Better Auth server ourselves.
     - **Client:** `@neondatabase/auth` (the standalone SDK; `@neondatabase/neon-js` bundles
       it with a Data API client this project doesn't use — no reason to pull that in
       alongside the existing `postgres.js` access in `lib/db.ts`).
       `authClient.signIn.magicLink({ email, callbackURL })` sends the email; confirmed to
       work with a plain Vite/React client, not Next.js-only.
     - **Server-side session verification** (the actual unknown): `jose`'s `jwtVerify()`
       against `NEON_AUTH_JWKS_URL`, checking the issuer against `NEON_AUTH_BASE_URL`.
       EdDSA public-key verification — no shared secret to manage, which fits this
       codebase's existing pattern of Vercel functions holding exactly one DB credential
       and nothing else sensitive.
     - **Correction, checked directly against this project's Vercel setup:** env vars do
       **not** auto-inject here. That behavior depends on the Vercel↔Neon *marketplace*
       integration, which this project doesn't have — `DATABASE_URL`/`DATABASE_URL_UNPOOLED`
       are plain manually-set env vars (`vercel env ls` / `vercel integration ls` confirmed
       no installed resources), not integration-managed. `NEON_AUTH_JWKS_URL` and
       `NEON_AUTH_BASE_URL` have to be copied from the Neon console's Auth section and set
       by hand (`vercel env add`), same as `DATABASE_URL` always has been. Both values are
       public (a JWKS endpoint and an issuer URL, not secrets), so this is low-stakes, just
       manual. Installing the marketplace integration instead was considered and rejected —
       it would also change how `DATABASE_URL` itself is provisioned on a project that
       already works, a real infra change for convenience this doesn't need.
     - **Data lands in `neon_auth.*`** inside this project's own Neon database, not a
       separate managed store — consistent with the "one Postgres, no separate auth
       store" shape the rest of this app already has.
     - Sources: [Neon Auth overview](https://neon.com/docs/auth/overview),
       [Magic Link plugin guide](https://neon.com/docs/auth/guides/plugins/magic-link),
       [Neon Functions authentication](https://neon.com/docs/compute/functions/authentication),
       [Auth in Vercel previews](https://neon.com/blog/auth-that-just-works-in-vercel-previews).
   - **New risk surfaced by that check, not previously known:** every relevant package is
     still **beta** as of 2026-07-28 (`@neondatabase/auth` 0.4.2-beta,
     `@neondatabase/neon-js` 0.6.2-beta, `@neondatabase/auth-ui` 0.2.1-beta — checked via
     `npm view`, not just docs copy). Shipping production admin auth against a beta SDK
     carries real API-stability risk. The blast radius is genuinely small here (a handful
     of admin accounts, `ADMIN_TOKEN` staying as a parallel fallback per the transition
     plan above), which argues for accepting it — but that's a call for whoever's
     resourcing this, not a default to wave through silently.
   - **Soft risk, not a blocker:** the only official worked example
     (`neondatabase/neon-js`'s `neon-auth-magic-link-example`) is Next.js. The
     JWKS-verification and client-SDK calls above are framework-agnostic in principle, but
     nobody's confirmed them working against this repo's hand-rolled
     `api/v1/[...path].ts` dispatcher specifically — first real implementation PR should
     expect some trial and error here, not a copy-paste.
   - **Frontend shape (not yet built, see blocker below):** `AdminApp.jsx`'s token-entry
     form becomes an email-entry form → "check your email" state → session established
     when the link is followed. Cross-origin matters here: Neon Auth's base URL is a
     different registrable domain from `betuveto.vercel.app`, so a session cookie the
     callback sets is never attached to `/api/v1/admin/*` fetches automatically — the
     client reads the session token via the SDK's `getJWTToken()` and sends it explicitly
     as `Authorization: Bearer <token>`, the same shape `AdminPlayersPanel.jsx` already
     uses for `x-admin-token`.

   **Backend verification prep shipped 2026-07-28** (PR #33, `0264bd9`):
   `migrations/0008_players_auth_user_id.sql`, `lib/neon-auth.ts` (the `jose`/JWKS
   verification above), `lib/admin.ts`'s `isAdminAuthorized` split into token-or-session
   (both independent — a missing/misconfigured `ADMIN_TOKEN` no longer denies the Neon Auth
   branch, and vice versa). Contract test added: a garbage `Authorization: Bearer` value
   401s the same as a wrong `x-admin-token`. None of this touches account creation or
   linking, so it isn't on the vulnerability below — verified live in production
   (migration applied, both no-credential and garbage-bearer-token requests 401).

   **Frontend flow deliberately held back, same session:** installing
   `@neondatabase/auth` in `frontend/` (needed for the client-side magic-link trigger)
   pulled in a **critical, currently unpatched** advisory —
   [GHSA-qq9h-g4jm-xgf3](https://github.com/advisories/GHSA-qq9h-g4jm-xgf3), account
   takeover via pre-account hijacking on magic-link/email-OTP sign-in, in the `better-auth`
   version this SDK bundles (vulnerable range `>=1.1.3 <1.6.22`; installed via
   `@neondatabase/auth@0.4.2-beta` was `1.4.18`; `npm audit` reports no fix without a
   semver-major SDK bump). Attack shape per the advisory: an attacker registers an account
   for the victim's email via email+password sign-up *before* the victim ever completes a
   magic link; the passwordless flow later verifies that email without stripping the
   attacker's pre-set password or revoking their session. **Confirmed with the user
   2026-07-28: hold the frontend piece** until `better-auth` patches past 1.6.21 (or
   Neon's SDK bumps its pin) rather than accept this specific CVE — a materially different,
   more specific risk than the general beta-API-stability risk accepted earlier in the same
   conversation. `@neondatabase/auth` was installed, found vulnerable, and removed from
   `frontend/package.json` again in the same session — never merged.

   **Frontend shipped 2026-08-20 — hold lifted, CVE confirmed patched.** Re-checked before
   resuming, not assumed: `npm view @neondatabase/auth@latest dependencies` now shows
   `better-auth@1.6.23` (past the vulnerable `<1.6.22` range), and a real `npm audit`
   against a fresh install shows no trace of GHSA-qq9h-g4jm-xgf3 — confirmed by the number,
   not just "should be fixed by now." Also found, not previously known: `NEON_AUTH_JWKS_URL`
   / `NEON_AUTH_BASE_URL` / `VITE_NEON_AUTH_URL` had never actually been set on Vercel
   (`vercel env ls` showed nothing) despite the backend prep above shipping against them —
   and zero `players` rows had `is_admin` or `auth_user_id` set, confirmed by direct query.
   Both fixed this session: the three env vars set (all three environments, `--no-sensitive`
   — the plain `vercel env add` default is the same "permanently unreadable" Sensitive type
   this project already hit once with `ADMIN_TOKEN`, so this is now a standing thing to
   check every time a new non-secret env var gets added here); the admin-row link is a
   manual SQL step by design (see below), not automated.
   `frontend/src/neonAuth.js` (`createAuthClient(VITE_NEON_AUTH_URL)`, `null` when the env
   var is absent so the app still renders the token-only path if it's ever unset again).
   `AdminApp.jsx`'s login screen gained an email-entry form above the existing token field
   (`signIn.magicLink({email, callbackURL})` → "check your email" state); the `token` prop
   threaded to all 4 admin panels became `authHeaders` (`{'x-admin-token': ...}` or
   `{Authorization: 'Bearer ' + jwt}`, whichever credential is live) — mechanical but
   touches all 4 panel files plus `AdminApp.jsx` itself, since `ADMIN_TOKEN` stays valid in
   parallel per the transition plan above.
   **Deliberately not automated: linking a Neon Auth identity to `players.is_admin`.**
   Neon's console has new-user signup enabled, so *any* email can complete a magic link —
   `is_admin` is the entire security boundary, and auto-granting it on first sign-in would
   be a privilege-escalation hole open to the whole internet. `players.auth_user_id`/
   `is_admin` are set by one manual `UPDATE` after the admin's own first real sign-in, same
   bootstrap pattern as `is_admin` always had (5.1) — no in-app flow grants either.
   **Real, unplanned bundle-size regression caught and fixed before merge, not shipped
   broken:** `@neondatabase/auth` alone roughly doubles the built JS (measured: ~320kB ->
   ~650kB minified) — and `main.jsx` imported `AdminApp` unconditionally, so every *player*
   would have downloaded the whole admin auth SDK on every visit for a feature only an
   admin ever uses. Fixed with `React.lazy(() => import('./AdminApp.jsx'))` — the admin
   panel (now including the auth SDK) becomes its own chunk, fetched only when a browser
   actually requests `/admin`; the *player*-facing bundle came out smaller than before this
   item (AdminApp's own code was previously bundled into every player's download too, not
   just the auth SDK). Riding along: `vite.config.js`'s PWA `globIgnores` now excludes the
   `AdminApp-*.js` chunk from the service worker's precache list — it has no offline mode
   either (an admin needs a live DB connection regardless), so precaching it would only
   cost every player background bandwidth for a page they'll essentially never visit.

   **STATUS CORRECTION, 2026-08-21: NOT WORKING END-TO-END — do not read the paragraphs
   above as "done."** The code above shipped and is live, and a real SDK bug it also
   fixed (PR #48: `getJWTToken()` skips the request hooks that handle Neon's cross-origin
   session handoff; switched to `getSession()`) was confirmed necessary — but sign-in
   still does not persist for the user. After PR #48, in incognito, the admin dashboard
   rendered *briefly* before a real `/api/v1/admin/dashboard` 401 logged the user back
   out. A fresh admin `players` row was linked via manual SQL
   (`auth_user_id = '59525a51-4f69-448e-a430-37c3fd43012a'` for `stamas83@gmail.com`) —
   the step expected to close this out — and the user still reports the same failure.
   Root cause not yet found. Full open-investigation detail (what's been ruled out, what
   to check first — decode a real JWT's `sub`/`iss`/`exp` against a live 401, before
   writing any more code) is in this project's own memory
   (`betuveto-magic-link-cve-hold.md`); read that before resuming, don't re-derive from
   scratch. `ADMIN_TOKEN` remains the working admin-login path throughout.
   **Edit/delete words and search-the-wordlist shipped 2026-07-28** (`lib/admin-words.ts`):
   `searchWords` (substring match, or latest-added with no query), `editWord` (renormalize,
   409 on a spelling collision), `deleteWord` (hard delete — cascades its reports/
   suggestions). Both refuse to touch a word that is the *current* target of an active
   game (scoped by wordlist_id): `games.target_word` is a text snapshot, not a foreign
   key, so mutating the `words` row would silently strand that game.
2. `[x]` **Config editor:** hint cost, completion bonus multiplier, guess rate limit, min
   word length, and the timer formula move from hardcoded constants to an admin-editable
   `config` table; edits take effect without redeploy.
   **Shipped 2026-07-28** (`lib/config.ts`, `migrations/0005_config.sql`): reads cached at
   module scope for 30s so the guess/hint/start hot paths don't hit the DB every request —
   an edit propagates to other warm instances within that window, not instantly everywhere
   (a PATCH only clears the cache on the instance that served it). Falls back to the
   compiled-in default for any missing/malformed key. `lib/words.ts`'s `durationForLength`
   and `lib/game.ts`'s `findableWords` now take the relevant values as parameters instead
   of reading module constants, keeping `words.ts` DB-free per its own stated invariant.
   **Real bug caught before merge:** the first version wrote
   `JSON.stringify(value)::jsonb`, which double-JSON-encoded the value (postgres.js's own
   jsonb parameter serialization already encodes it) — a PATCH looked like it succeeded
   but the column silently held the *string* `"99"` instead of the number `99`, so every
   read fell back to the default. Caught by querying the preview DB directly after a PATCH
   kept reading back stale well past the 30s cache TTL; fixed with `sql.json(value)`, the
   same helper `lib/admin.ts`'s `logAdminAction` already used for its own jsonb column.
3. `[x]` **Score/player maintenance:** view players, edit/delete suspicious leaderboard
   entries, rename inappropriate display names. **Shipped 2026-07-28**
   (`lib/admin-players.ts`): player search/list with a games-played + best-score
   aggregate per row, rename (20-char cap — not tied to any existing enforced limit, since
   the player-facing "name yourself" input this number came from was never built);
   leaderboard-entry listing broader than the public per-length top-10, and a `disqualify`
   action per game. **Deliberately not built: merging duplicate players (anonymous +
   OAuth).** That's the exact operation Batch 8's Google OAuth merge rule already
   specifies (orphaned-anonymous-player stats merge additively into the Google-linked
   player) — building a separate version here would either duplicate that logic or
   pre-empt a design that batch hasn't landed yet. Revisit as part of Batch 8, not before.
   **Design choice:** disqualifying a game sets a new nullable `games.disqualified_at`
   (`migrations/0006_games_disqualified.sql`) rather than a new `status` enum value —
   keeps the game's real lifecycle status distinct from an admin's later leaderboard
   decision, and avoids touching the `games_status_check` constraint or auditing every
   `status === 'active'` branch in `lib/game.ts` for a new possible value. `lib/scores.ts`
   excludes disqualified games from both the public top-N and `your_best`; the row and its
   `game_guesses` history stay intact, only leaderboard visibility changes.
4. `[x]` **Dashboard:** games/day, DAU, most-failed words, report queue size.
   **Shipped 2026-07-28** (`lib/admin-dashboard.ts`): read-only, no `admin_audit_log`
   writes (nothing to attribute). Games/day + DAU as one 30-day zero-filled series —
   `generate_series` left-joined against `games` on a per-day `started_at` range (not
   `date_trunc(started_at) = d`), so the query stays index-backed via a new
   `games_started_at_idx` (`migrations/0007_dashboard_indexes.sql`) instead of a
   sequential scan. Most-failed words aggregated across `word_stats`
   (`sum(times_failed)` grouped by word — one word's failures are spread across many
   players' rows). Queue counts use a second new partial index mirroring
   `word_reports`'s existing one. Verified with the full contract suite (76/76) against
   the PR's own preview deployment, then again live in production.
- **Audit:** every admin mutation writes to `admin_audit_log(admin_id, action, payload,
  created_at)`. **Shipped 2026-07-27** (`migrations/0004_admin_audit_log.sql`) — `admin_id`
  stays null for now: the interim `ADMIN_TOKEN` auth (5.1) has no per-admin player
  identity to attribute an action to, only becoming meaningful once Batch 8's Google OAuth
  gives admins a real logged-in identity. `logAdminAction` moved to `lib/admin.ts` on
  2026-07-28 so every admin-mutating module (queue, words, config, players) shares one
  writer instead of reimplementing it per file.

---

## Batch 6 — Internationalisation: English (and the door to more languages)

### 6.1 `[x]` Wordlist plumbing (mostly done in Batch 1 schema)
- Add `en` wordlist. **Source & licence matter:** use a public-domain/free list —
  ENABLE (public domain) or SCOWL (permissive) are the standard choices; filter to 3–15
  letters, lowercase-only entries (drops proper nouns), no diacritics. Document the
  choice and licence in `data/README.md`. Also *verify and document the licence of the
  existing Hungarian list* — currently unstated in the repo.
- Language selector on the start screen; game rows already carry `wordlist_id`;
  leaderboards are per wordlist+length (already keyed that way from Batch 2).
- **Shipped 2026-07-29:** `data/english-words.txt` — the `word-list` npm package
  (sindresorhus, MIT, SCOWL-derived, 4.1.0), chosen over ENABLE/raw SCOWL because it's
  already exactly the shape 6.1 asks for (lowercase-only, no proper nouns, no diacritics,
  word-game-oriented) and its licence is unambiguous; full attribution and the Hungarian
  list's honest "provenance unknown, licence unverified" status (Batch 0.9's TODO,
  confirmed still unresolvable) both in `data/README.md`. `game/start`, `words/count`, and
  `words/lengths` now take a `?wordlist=` param (defaulting to `hu`); a start-screen
  selector added alongside the existing length selector, restarting only when it's safe to
  (mirroring the length selector's own rule) and re-fetching available lengths per
  wordlist (English clears the >=500-candidate bar at every length 5–10, same as Hungarian).
  **Two pre-existing gaps surfaced and fixed while wiring this up, not introduced by it:**
  (1) `word_stats` was keyed only on `(player_id, word)` since Batch 1.1 — harmless with
  one wordlist, but a spelling common to two languages (1,970 exist between these two
  lists, e.g. "ALMA") would have merged its failed/solved counts across languages the
  moment a second wordlist existed. Fixed in `migrations/0009` — added `wordlist_id`,
  widened the primary key to `(player_id, wordlist_id, word)`, existing rows backfilled to
  `hu`. Not covered by an automated regression test: forcing the *same* spelling to land as
  the server's randomly-chosen target in both an independent hu draw and an independent en
  draw isn't practically triggerable through the black-box contract suite without enough
  retries to make it slow and flaky; the fix follows directly from the primary-key change
  and was reviewed at the migration/code level instead. (2) `lib/db.ts`'s `wordlistId()`
  cache held only its last-seen code — harmless when 'hu' was the only code ever requested,
  but would have thrashed (missed on every call) once 'hu' and 'en' requests interleave
  within one warm serverless instance. Changed to a `Map`.

### 6.2 `[x]` UI string i18n
- All user-facing strings are currently hardcoded Hungarian in `App.jsx` **and in backend
  response `message` fields.** Two rules for the implementer:
  1. Backend stops sending display strings — it returns machine-readable codes
     (`result: "not_in_dictionary" | "cannot_form" | "already_guessed" | ...`) and the
     frontend maps codes → localised text. (This also cleans up the API.)
  2. Frontend: `react-i18next` with `hu` and `en` JSON catalogs; language auto-detected,
     overridable, persisted per player.
- Keyboard handling: the accepted-keys whitelist in `App.jsx` hardcodes the Hungarian
  alphabet — derive it from the active wordlist's alphabet (serve alphabet metadata with
  the wordlist).
- **Shipped 2026-07-29/30:** `lib/game.ts`'s `guess()` now returns a `result` code
  (`time_expired | too_short | not_in_dictionary | cannot_form | already_guessed | correct`,
  the last two also carrying `total_score`/`min_length` since those were previously only
  readable from the now-removed prose); `giveUp()`/`rescramble()` drop `message` entirely
  (their other fields — `target_word`, `scrambled_letters` — already carry everything the
  frontend needs). `lib/hints.ts`'s two displayed 400s (`game_not_active`,
  `no_hintable_words`) became codes in the existing `detail` field rather than a new one,
  since that's the only `detail` the frontend actually reads (`client.ts`'s `getHint()`).
  Every other `detail` field across the API was left as English prose on purpose — a
  repo-wide audit (`client.ts`'s error handling) found the frontend never surfaces them to
  the player at all, so translating unseen text isn't this item's job.
  `frontend/src/i18n/` (`react-i18next` + `i18next`, no `-browser-languagedetector`: the
  existing mount effect that already resolves `preferred_length` now also resolves
  `preferred_language` the same way — player preference, then `navigator.language`, then
  `hu` — one fewer dependency for a single comparison). `players.preferred_language`
  (`migrations/0010`, independent of a game's wordlist per the roadmap's own separation of
  6.1 vs 6.2) read/written via the existing `/me/preferences` route. `wordlists.alphabet`
  (added in 6.1's migration 0009) now also served on `game/start` and drives the keyboard
  whitelist directly, replacing the hardcoded Hungarian one.
  **Real, adjacent bug caught and fixed while wiring the alphabet through, not a planned
  part of this item:** `lib/word-suggestions.ts` validated every suggested word against a
  hardcoded Hungarian-only alphabet regardless of `wordlistCode` — a real functional bug
  once English suggestions became possible (e.g. "QUIZ" would have 422'd). Fixed to
  validate against the target wordlist's own `alphabet` column instead.
  **Two pieces of dead/vestigial frontend logic found and simplified while touching this
  code, not new scope:** the bottom-of-page inline error banner was unreachable in
  practice (the full-page error screen above it always intercepts first, since
  `startNewGame`'s catch sets `error` and `isLoading` in the same React batch) — kept
  as a safety net but its `error.includes('újrakeverve')` styling check (which nothing had
  set for a long time) was removed rather than translated meaninglessly.
  **Deliberate architecture note:** `startNewGame` stores a translation *key* in `error`
  state (not pre-translated text) and stays a dependency-free, stable `useCallback` — it's
  relied on as a `useEffect` dependency (the mount effect), and letting it depend on `t`
  would mean every language switch recreates it, re-fires that effect, and silently
  restarts the player's in-progress game. Every other handler (`handleSubmit`,
  `handleUseHint`, etc.) is only ever an event-handler prop, never an effect dependency, so
  those safely call `t()` directly and list it in their own deps.

### 6.3 `[x]` Further languages (design note, no build work — nothing to ship, closed 2026-07-30)
- After 6.1/6.2, a new language = wordlist file + import + JSON catalog. German/Spanish
  need no code. **Warning for future implementers:** languages with digraph collation
  (Hungarian already: `cs`, `sz`…) are handled letter-by-letter here by design — do not
  "fix" collation in `_can_form_word`. Languages with non-Latin scripts (grapheme
  clusters) would need review of letter-splitting (`split('')` in JS is not
  grapheme-safe) — defer until such a language is actually requested.

---

## Batch 7 — Multiplayer (co-op rooms)

*The biggest batch. Do not start until Batches 0–3 are done and stable.*

### 7.1 `[ ]` Design (as specified)
- 2+ players work **simultaneously on the same board**. Each player finds words
  privately; others see **how many** words each player found and their score — **not
  which words** (until game end, when everything is revealed).
- Same scramble, same timer for all (server clock, already authoritative after 0.4).
- Decide-and-document (recommendations): a word found by two players counts for **both**
  (pure co-op/race feel, simpler; "first-finder-only" is more cut-throat and needs
  claim-ordering — make it a room option later, not now). Completion bonus splits when
  the room *collectively* finds all words.

### 7.2 `[ ]` Implementation plan
- Tables: `rooms(id, code 6-char join code, host_player_id, game_id, status, created_at)`,
  `room_players(room_id, player_id, joined_at, score, found_count)`.
- REST: create room → get join code; join by code; start (host only).
- **Ably** channel `room:{code}` (token-authed so only room members can subscribe):
  clients subscribe with `ably-js`; **presence** tracks who's in the lobby; the guess API
  route publishes (server-side, with the Ably server key) `game_started` (scrambled letters
  + ends_at), `progress_update {player, found_count, score}` on every correct guess, and
  `game_over {full reveal: per-player word lists, remaining words}`. Guesses still go over
  REST (Ably is push-only here) — the guess handler just also publishes.
- Frontend: lobby screen (create/join with code), in-game opponent progress sidebar,
  end-of-game comparison view.
- **Gotchas to write into the task:** reconnection (client re-subscribes to the channel
  and GETs a room-snapshot endpoint to resync); room TTL/cleanup; cap room size (e.g. 8);
  keep broadcasts coarse — Ably's free tier is 6M messages/month / 200 concurrent; use Ably
  token auth so only room members can subscribe.
- **Suggested cheap precursor (consider shipping as 7.0):** a **daily puzzle** — same
  word for everyone each day, with a daily leaderboard. ~10% of the effort, delivers much
  of the social value, and creates a retention loop. Reuses everything from Batch 2.

---

## Batch 8 — Google OAuth (identity upgrade) 

### 8.1 `[ ]` Google sign-in via Neon Auth identity linking
- "Keep my progress" links a Google identity to the current user via **Neon Auth** (Better
  Auth's account-linking) — history and scores are kept because the user id doesn't change.
  On a new device, signing in with Google resolves to the already-linked user — cross-device
  continuity is the entire point of this batch. (One-time setup: GCP OAuth client + enabling
  the Google provider in Neon Auth.)
- Batch 2 uses the signed-cookie identity (Neon Auth has no anonymous sessions, confirmed —
  see architecture decision 4), so this batch is where Neon Auth is first introduced: link
  the Google login to the cookie's `players` row on first sign-in.
- Merge rule — the only real code in this batch: if the *new device* accumulated
  anonymous games before signing in, linking fails (the Google identity already belongs
  to another user); instead sign in and merge the orphaned anonymous player's stats into
  the Google-linked player (keep both game histories; `word_stats` rows merge
  additively), then delete the orphan. Write this as an explicit, tested service
  function; it's the fiddliest part.
- Admin login switches from `ADMIN_TOKEN` header to `is_admin` on the Google-linked player.
- Keep anonymous play fully functional forever.

---

## Batch 9 — Android app

### 9.1 `[x]` PWA hardening first
- `vite-plugin-pwa` is configured but the manifest references `pwa-192x192.png` /
  `pwa-512x512.png` that **do not exist in `frontend/public/`** — create real icons
  (+ maskable variants), add offline fallback page, verify Lighthouse PWA pass,
  add install prompt UX.
- **Shipped 2026-07-24:** real icons (from an earlier PR) plus `navigateFallback:
  '/index.html'` with an `/api/` denylist in the Workbox config (confirmed present in the
  built service worker, live in production), an `OfflineNotice` banner, and an
  `InstallPrompt` component that captures `beforeinstallprompt` at module scope (survives
  the loading-screen race) with a localStorage-dismissed flag; iOS Safari shows nothing
  since it never fires that event. **Not yet done:** the actual Lighthouse PWA audit needs
  a real browser against a live deployment — still pending, do it by hand when convenient.

### 9.2 `[ ]` Play Store via Trusted Web Activity
- Attach a custom domain to the Vercel project first (free on Hobby) so the TWA is bound
  to a domain you control, not `*.vercel.app`.
- Use **Bubblewrap** to wrap the (HTTPS-hosted) PWA as a TWA; add
  `assetlinks.json` to the frontend host; produce a signed AAB.
- **Challenge to the original idea:** a *stand-alone native* Android version means a
  second codebase (or a React Native port) for a game whose UI is a text input and
  buttons — permanent double maintenance for near-zero UX gain. TWA gives Play Store
  presence, home-screen icon, full-screen play, and reuses every batch above. Only
  revisit native if a hard requirement appears (offline single-player with bundled
  wordlist is the one plausible one — and even that is achievable in the PWA service
  worker by caching a wordlist slice).
- One real cost to note: Play Store TWA requires the site to stay up; offline play
  requires the service-worker wordlist work either way.

---

## Batch 10 — Backlog / ideas

**Sequencing agreed with the user 2026-07-28/29** (was "unordered; pull into batches as
desired" — now ordered below). Rationale: lead with the daily puzzle rather than cheaper
items first, because the roadmap's own 7.2 note already frames it as the best
value/effort ratio in this whole list (~10% of multiplayer's effort, delivers much of its
social value, creates a retention loop that nothing else here does) — cheap-but-smaller
items shouldn't bury the one item that's both cheap *and* high-value. Order isn't a hard
dependency chain (most items are independent); it's a priority queue, revisit freely.

1. `[ ]` **Daily puzzle + streaks** (see 7.2 note — arguably belongs before multiplayer).
2. `[x]` **Difficulty rating per word** — % of games where the target was found; feed back
   into word selection ("easy mode" picks well-known words). Data starts accruing the
   moment Batch 1 lands, so log now, build later. Pairs naturally with the 5.2 item 4
   dashboard already shipped — a "hardest words" view is a small extension of the
   existing "most-failed words" query in `lib/admin-dashboard.ts`.
   **Shipped:** `word_stats` (written since Batch 3.3, only ever for a game's *target*
   word) already *is* this data — `lib/word-stats.ts`'s new `getHardestWords()` /
   `pickEasyWord()` aggregate it across all players, scoped per wordlist, gated behind a
   `MIN_ATTEMPTS_FOR_DIFFICULTY = 5` floor so a word tried once or twice can't read as an
   artificial 0%/100%. New index `migrations/0012` matches the `group by (wordlist_id,
   word)` both queries share. Admin dashboard: a new "hardest words" (lowest success rate)
   section alongside the existing "most failed" (raw count) one — **real pre-existing bug
   fixed in the same PR:** `most_failed_words` was never scoped by wordlist, so a spelling
   shared between hu/en (e.g. "ALMA") silently merged its counts across languages, the same
   bug shape `getMyStats`'s `failed_words` had (fixed in PR #37) — never caught here since
   it's an admin-only view. Easy mode: `POST /api/v1/game/start?difficulty=easy` biases
   target selection toward words with a proven ≥60% aggregate success rate; falls back to
   the normal uniform-random pick (silently, not an error) whenever nothing yet qualifies
   for a given wordlist+length. The response's `difficulty` field always echoes the actual
   outcome, never just the request, so the frontend's toggle can't claim an easy-mode game
   that quietly wasn't one. Frontend: a session-local (not persisted) "Könnyű mód" checkbox
   next to the length/wordlist selectors, same "restart only if safe" rule as those.
   **Known limitation, confirmed live 2026-07-30, not just a slow warm-up:** checked
   production directly post-merge — `hardest_words` is empty and every `difficulty=easy`
   request falls back to `normal`, because `most_failed_words`' own top row sits at
   `times_failed: 1`. `MIN_ATTEMPTS_FOR_DIFFICULTY = 5` (`lib/word-stats.ts`) needs 5
   attempts on one exact word, but uniform-random selection across ~152k (hu) / ~270k (en)
   words means most words are picked at most once at this project's traffic — this is the
   steady state at hobby scale, not a cold start that resolves itself given time. Both
   features are correct and live but currently do nothing observable. Before relying on
   either: lower the threshold (weakens the anti-noise guarantee it exists for), or seed
   difficulty from a different signal (e.g. word frequency in the source corpus) instead of
   live-play volume — a decision for whoever picks this up next, not made here.
3. `[x]` **Spaced-repetition polish** — the failed-word reappearance system is a genuinely
   distinctive learning feature; once server-side (Batch 1), expose it: "words you're
   practising" panel, per-word progress.
   **Shipped as a UI-only panel first (same day), then reversed and rebuilt server-side
   (same day, product correction) — this item's final, actual scope is the second entry
   below.**
   - **First shipped, UI only per this item's original text — confirmed with the user
     first:** a pre-existing comment in `lib/game.ts`'s `startGame` (predating that
     session) described this item differently — as server-side weighting of target-word
     draws toward a player's own past failures. Asked which was intended rather than
     silently picking one; user confirmed UI-only at that point. Built a "🎯 Gyakorlásra
     váró szavak" (words to practice) panel reusing `getMyStats`'s `failed_words`, no new
     endpoint. Verified (including an actual headless-Playwright click-through against
     production once the user pointed out Playwright was available, not just the Chrome
     extension — a local `vercel dev`/`vite` bug this surfaced, unrelated to any of this
     session's changes, is recorded in this project's session memory, not repeated here)
     and shipped.
   - **Reversed the same day:** the user pushed back — this is not an educational/practice
     game, and revealing any per-word history to players (which words they failed, a
     "previously failed" badge, a practice list) was a design mistake to have overlooked,
     not a feature to keep. The UI-only interpretation confirmed above turned out to be
     the *wrong* one after all; the pre-existing `lib/game.ts` comment's server-side
     framing was actually closer to the real intent, just under-specified. Removed
     entirely: the practice panel, the general stats panel's failed-words list, and the
     `is_previously_failed` "previously missed" badge (Batch 0.1) — all deleted from both
     the frontend and the API response (`getMyStats`, `game/start`), not just hidden.
     `longest_word_found` was kept (backend field only, not currently displayed) as a
     candidate data source for a *future*, different kind of feature: a non-exhaustive,
     occasionally-surfaced "did you know" highlight (e.g. fastest solve, longest streak)
     between turns — explicitly not built this session, a later idea only.
   - **What actually replaced it — real server-side personalization, word_stats' original
     stated purpose (its own table comment since migrations/0001: "feeding the failed-word
     reappearance weighting") finally built:** `lib/word-stats.ts`'s `recordSolved`/
     `recordFailed` now also stamp `mastered_at_game_number` (migrations/0013) — this
     player's total game count, snapshotted the moment their own solve rate for a word
     first reaches 90% (no minimum-sample floor, deliberately different from
     `MIN_ATTEMPTS_FOR_DIFFICULTY`'s cross-player noise guard elsewhere in the same file —
     a single personal solve is already a legitimate "don't show me this again" signal),
     cleared back to null if a later failure drops the rate back below 90%. New
     `pickPersonalizedWord()` is the new default target picker (replacing the old plain
     `order by random()`): prefers a word this player has never had as a target before,
     excludes any word currently in that player's own ~100-game mastery cooldown, one
     query (`LEFT JOIN` + `order by (ws.word is null) desc, random()`). "Easy mode"
     (item 2) now also respects the same cooldown. **Performance verified against
     production before shipping, not assumed:** `EXPLAIN ANALYZE` at the widest real case
     (English, length 9, ~41k candidate words) — tens of milliseconds, same order of
     magnitude as the plain `order by random()` query already running on every game start
     since Batch 1; the new `LEFT JOIN` against `word_stats` (currently ~100 rows) adds
     negligible cost. None of this is visible to the player — no badge, no panel, no
     history — it only changes which word gets picked.
   - **Known correction, flagged by the user right after this shipped — fixed
     2026-08-19.** "Mastered" had been computed as an aggregate ratio (across every time
     this exact word was ever this player's target, was it found ≥90% of those times)
     instead of the intended per-game, letter-weighted check: within a *single* game, do
     the words the player found add up to ≥90% of the total letters across every findable
     word on that board (e.g. finding 45 of a board's 50 total-letters-across-possible-
     words qualifies) — a near-full-clear in one sitting, not a repeated-encounter solve
     rate. Fixed: `lib/words.ts`'s new pure `letterClearFraction(possible, found)` computes
     that fraction (unit-tested in `tests/words.test.ts`, including a case that pins the
     letter-weighting itself — missing a long word must hurt more than missing a short
     one). `lib/game.ts`'s `finalizeWordStats` (replacing the old `recordFailureIfNeeded`)
     runs it once at each of a game's three true terminal transitions — a full clear inside
     `guess()`, a lazily-discovered timeout in `finalizeExpiry`, or an explicit `giveUp` —
     and calls `lib/word-stats.ts`'s new `applyGameMastery`, which always overwrites
     `mastered_at_game_number` from *this* game's fraction (qualifying game → stamp the
     current game count; non-qualifying → clear to null) rather than deriving it from
     `times_solved`/`times_failed`. `recordSolved`/`recordFailed` are now pure counters, no
     longer mastery-aware. No new migration — `mastered_at_game_number` (migrations/0013)
     is unchanged; only how it's written changed.
4. `[x]` **Accessibility pass** — the letter buttons and animations need ARIA labels,
   focus order, reduced-motion support (`prefers-reduced-motion` for confetti/shake). A
   correctness gap, not a nice-to-have — cheaper the sooner it's done.
   **Shipped:** most of this item's own examples turned out already done, incrementally,
   across many earlier batches never tracked against this checkbox — letter buttons are
   real `<button>`s with `aria-label`s, the board/score/timer/selectors already carry ARIA
   roles and labels, and `index.css` already has a blanket
   `@media (prefers-reduced-motion: reduce)` rule (neutralises every CSS animation/
   transition site-wide, not just shake) plus the confetti/explosion already skip
   themselves in JS when it's set. Three real, previously-unaddressed gaps found and
   fixed instead: (1) `<html lang="hu">` was hardcoded in `index.html` and never updated
   when a player switches UI language (ROADMAP 6.2) — now a `useEffect` on `i18n.language`
   keeps it in sync, covering every way the language can change (selector, saved
   preference, browser-language fallback). (2) Three transient toasts (rejected-guess
   overlay, hint result, word-suggestion prompt/thanks) had no `aria-live`/`role`, so a
   screen reader announced nothing when they appeared — added `role="alert"` to the
   guess-rejection toast (urgent) and `role="status" aria-live="polite"` to the other two
   (informational). (3) `ConfirmationModal` had no dialog semantics at all: no
   `role="dialog"`/`aria-modal`/`aria-labelledby`, no focus moved into it on open, no
   Escape-to-close, and no focus restored to the trigger on close — all four added.
   **Real bug caught while building the fix, not shipped broken:** an initial version put
   `onClose` in the focus-management effect's own dependency array; the game timer
   re-renders `App` (and recreates its inline `onClose`) every 500ms while a game is
   active — exactly when this modal can be open — so that version would have stolen focus
   back to the cancel button and reset `previouslyFocusedRef` twice a second. Fixed with
   the standard latest-ref pattern (`onCloseRef`, updated every render but not in the
   effect's deps) so the effect only re-runs when `isOpen` itself actually flips.
   Initially verified only via typecheck/lint/build plus a manual trace of the re-render
   timing above — **later confirmed by an actual headless-Playwright click-through against
   production**, same session: `role="dialog"`/`aria-modal="true"`/`aria-labelledby` all
   present, focus lands on the Cancel button on open, Escape closes it, and focus returns
   to the "Új játék" trigger afterward — the exact behaviour the fix above was for. `<html
   lang>` sync and the `role="alert"` guess-rejection toast were confirmed the same way.
   Still not covered by this pass: global tab order was reviewed by inspection and judged
   already correct (not changed), not exercised interactively.
   Batch 6.2's mid-game language-switch UI and Batch 9.1's Lighthouse PWA audit remain
   unverified interactively — both are candidates for the same headless-Playwright-against-
   production approach that verified this item and item 3 above.
5. `[x]` **E2E smoke test** — one Playwright test (start game → guess a word → see score)
   in CI; catches the "white screen" class of regressions that has already happened once
   in this repo's history.
   **Shipped 2026-08-20:** `frontend/e2e/game.spec.ts` + `frontend/playwright.config.ts`.
   Runs against this PR's own bundle via `vite preview` (a static-file server — the local
   `vite dev` byte-offset bug this project's own memory documents can't apply there), with
   `/api` proxied to the live production API (`vite.config.js`'s new `preview.proxy`) —
   a preview deployment sits behind this project's Vercel SSO wall, which CI has no bypass
   secret for, and there's no local API server to test against since Batch 1.3's cutover
   to same-origin Vercel functions. The target word is computed the same way
   `tests/contract.test.ts` already does: read the board's own letters off the rendered
   page, then find a real word the shared Hungarian wordlist says the board can spell —
   deterministic, no server-side knowledge needed. **Deliberate tradeoff, not hidden:**
   every CI run of this job now writes one real (harmless) test game into production, and
   a production outage would fail this job even with entirely correct code — accepted
   since the existing contract suite already writes real data when pointed at a live
   deployment, and there was no lower-risk target available (see above).
   **Side effect flagged, not fixed here — a candidate follow-up for whoever next touches
   the admin dashboard (5.2 item 4) or item 9 (observability):** every CI run mints a
   fresh anonymous player and plays one real game, so `games/day`/DAU on the dashboard now
   partly count CI traffic, not people — at this project's actual traffic, CI runs could
   dominate both numbers. No filtering (e.g. by a marker on the row, or the anonymous-
   player pattern CI uses) has been built; decide with the user before building one, not
   assumed.
   **Hardened 2026-08-20, PR #47:** the original version picked its guess as the *first*
   dictionary-file match for the board and asserted the live API would accept it — but the
   flat file and the `words` table can drift (word maintenance, 5.2 item 1, deletes a row
   without touching the file; this repo already hit exactly this divergence once, PR #27's
   `total_words` assertion). A stale first-match candidate would fail *persistently* for a
   subset of boards, not flakily — indistinguishable from a real regression. Now tries up
   to 5 candidates per run, only failing if the live API rejects every one.
   **Two real bugs caught while writing this, not shipped broken:** (1) Playwright's
   default browser locale isn't Hungarian — the test initially failed because the UI
   rendered in English (`navigator.language` fallback, ROADMAP 6.2), silently using the
   wrong aria-label strings; fixed by pinning `use.locale: 'hu-HU'` in
   `playwright.config.ts` rather than depending on the runner's environment. (2) A found
   word renders as one combined text node ("SZÓ (9 pont)"), not the bare word — an
   `exact: true` text match failed for a reason that had nothing to do with whether the
   guess actually worked; switched to a substring match.
   **Also fixed, same session, not scoped to this item:** adding `@playwright/test` hit
   the exact npm 10/11 lockfile-drift issue from item 2 (see 5.2's history) —
   `frontend/package-lock.json` regenerated with `npx npm@10.8.2 install` to match CI's
   npm version, confirmed with a local `npm ci`. A new root `vitest.config.ts` scopes
   `test.include` to `tests/**/*.test.ts` explicitly — Vitest's default recursive
   `**/*.{test,spec}.*` glob was also matching `frontend/e2e/*.spec.ts` (a *Playwright*
   suite, meant to run via `npx playwright test`, not vitest) and crashing on it.
6. `[x]` **Definition lookup** — link found/missed words to a dictionary at game end.
   **Shipped 2026-08-03:** each word chip shown after a game ends now links to its
   language-appropriate Wiktionary entry (Hungarian or English, determined by the active
   wordlist rather than the interface language). Links open safely in a new tab and have
   localised accessible labels.
   **Correction, same day, before merge:** the first draft built the URL from the game's
   internal (uppercase) word form; Wiktionary page titles are case-sensitive and lowercase
   for ordinary words, so every link 404'd. Confirmed live (curl) that the uppercase form
   404s and the lowercased form 200s for several Hungarian entries, then lowercased in
   `definitionUrl` and fixed the unit test, which had been asserting the broken (uppercase)
   URL as correct. **Known residual gap:** lowercasing also erases proper-noun casing, so a
   proper noun in the wordlist would still link to a 404 — accepted, not fixed, since there's
   no information left post-normalization to recover correct casing.
7. `[ ]` **Dark mode** (Tailwind `dark:` variants; persist per player). Good vehicle to
   finally do the frontend refactor below, since it touches most of `App.jsx` anyway.
8. `[ ]` **Sound effects + toggle.**
9. `[ ]` **Observability** — structured logging + error tracking (Sentry free tier).
   Originally scoped as "before multiplayer debugging is needed" — moved up: bugs
   already slipping through unnoticed in production cost something *now*, not just once
   Batch 7 starts, and it's a few lines to wire.
10. `[ ]` **Achievements** (first 10-letter word, 7-day streak, full clear without
    hints…) — needs real schema/design work, no blockers, moderate value.
11. `[ ]` **CI-minted players flagged out of dashboard metrics** — closes the gap item 5
    above already flagged and left open: every CI run of the E2E smoke test mints a real
    anonymous player and plays one real game against production, so `games/day`/DAU on the
    admin dashboard (5.2 item 4) already silently include CI noise today, independent of
    any of items 12/13 below. Tag that player at creation (a marker column or a known
    `display_name` pattern) and have dashboard queries exclude it by default. Cheapest item
    in this batch and fixes existing numbers rather than adding a new capability — do this
    one first.
12. `[ ]` **Drill to individual game** — an admin detail view for one game's full
    guess-by-guess timeline. `game_guesses` already stores every guess with a timestamp;
    this is a join by `game_id`, no new data collection. Admin-only, so it doesn't conflict
    with the standing player-facing rule against showing a player their own word history
    (Batch 10 item 3) — that rule is about what a *player* sees, not admin visibility.
13. `[ ]` **Player stat drill-down** — avg game duration/player, avg games/player, and
    time-bucketed views (month/quarter, hour-of-day) on the admin dashboard (5.2 item 4).
    Mostly free: `games.started_at`/`ended_at`/`player_id` already exist, this is SQL
    aggregation on data already collected. Includes geolocation, scoped to **country-level
    only** (Vercel populates geo headers on every request automatically, no GeoIP
    service/cost needed) — deliberately not city/precise-coordinate, since nothing yet
    needs finer granularity and it's otherwise PII-adjacent data with no clear use.
    **Dashboarding-approach decision made with the user 2026-08-21:** build 2-3 reusable
    query+chart primitives inside the existing hand-rolled admin dashboard (one
    time-bucketed-metric query, one distribution query, reused per stat) rather than either
    self-hosting a BI tool (Metabase/Grafana/Redash — a new service to run and maintain,
    disproportionate ops for this project's traffic, and this machine can't run heavy
    stacks locally anyway) or adding a hosted analytics SDK (e.g. PostHog — would cover
    most of this item near-free, but is a new third-party dependency and the first time
    player behavior data would leave the project). Revisit the SDK option if the in-house
    primitives start feeling like real duplicated effort.
- **Frontend refactor** (not separately numbered — explicitly not a standalone task) —
  `App.jsx` is a 640-line single component; split into `components/` (Board, GuessInput,
  Timer, Scoreboard, Modal…) and a `useGame` hook *as part of* whichever numbered item
  above substantially touches `App.jsx` first (daily puzzle or dark mode are the two
  likeliest candidates) — never standalone (those go badly with AI implementers; always
  pair refactors with a feature that exercises them).
- **Privacy page + data deletion endpoint** (not separately numbered — sequenced by a hard
  constraint, not priority) — not urgent while identity is anonymous-only, but must land
  no later than **Batch 8** (Google OAuth): that's the moment real email addresses start
  being stored and GDPR actually applies. `DELETE /api/v1/me` wipes the player row and
  anonymises games.

---

## Challenged / rejected ideas (and why)

| Original idea | Verdict | Reasoning |
|---|---|---|
| Backend on HF Space | **Replaced with Vercel + Neon (Batch 1)** | Free HF has ephemeral disk (no DB), ~48 h sleep with slow cold starts, no custom domain (blocks the Batch 9 TWA). Once the DB is external anyway, HF is just a slow Python host. |
| Supabase for DB/Auth/Realtime | **Swapped to Neon (+ Ably for realtime)** | Free Supabase allocation is committed elsewhere. Neon is a clean Postgres swap that keeps the whole relational plan, bundles free managed auth (60k MAU, Google), and drops the 7-day-pause chore. Realtime (Batch 7 only) → Ably free tier. |
| Google OAuth as primary identity | **Deferred to Batch 8** | Anonymous identity delivers per-player features with zero friction; OAuth is a cross-device *upgrade*, not a gate — and Neon Auth identity-linking keeps it small. |
| Auto-email for reported words | **Rejected in favour of DB + admin queue** | Email infra is disproportionate overhead; the Batch 5 queue with badge count covers the need. Weekly digest is a cheap later add-on if wanted. |
| Stand-alone native Android app | **Replaced with PWA→TWA** | Second codebase for a text-input game; TWA gets Play Store presence reusing everything. Revisit only for offline-first requirement. |
| Multiplayer early | **Kept, but sequenced late (Batch 7)** | It's the largest feature and depends on sessions, server-authoritative scoring, and identity. The daily puzzle (7.0/Batch 10) delivers social value years earlier in effort-terms. |
| Word length 5–10 | **Accepted as-is** | Good bounds; verify per-length word availability and keep leaderboards per length. 7 stays default. |
| Words marked ≥2× inactivated | **Accepted, tightened** | "≥ 2 distinct players, open reports" to prevent one user double-reporting; never yank a live game's target. |

---

## Suggested delivery order & sizing

| Batch | Rough size | Depends on |
|---|---|---|
| 0 — Bugs & security | S–M (each item ≤ ½ day) | — |
| 1 — Foundations (Vercel + Neon port) | M–L | 0 |
| 2 — Identity + scores + length | M | 1 |
| 3 — Hints + bonus + stats | S–M | 2 |
| 4 — Word curation | M | 2 |
| 5 — Admin | M | 4 |
| 6 — English / i18n | M | 1 (2 for prefs) |
| 7 — Multiplayer | L–XL | 0–3 |
| 8 — Google OAuth | S | 2 |
| 9 — Android (TWA) | S–M | stable deploy |
| 10 — Backlog | à la carte | varies |

**Working agreement for AI-assisted delivery:** one batch item = one PR; every PR adds or
updates tests in `backend/tests/`; every PR updates the checkbox here. Batches 0 and 1
must not be parallelised with anything else.
