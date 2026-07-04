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
> **Status legend:** `[ ]` not started · `[~]` in progress · `[x]` done

---

## Current state (as of 2026-07, for orientation)

| Component | Location | Notes |
|---|---|---|
| Backend API | `backend/main.py` | FastAPI, single file, ~320 lines. **One global `GameState` shared by every visitor.** No DB, no auth, no tests. |
| Frontend | `frontend/` | React 19 + Vite 7 + Tailwind 3, PWA plugin configured. All persistence in `localStorage`. Timer, high scores and "failed words" learning live **client-side only**. |
| Word list | `data/magyar-szavak.txt` **and** `backend/data/magyar-szavak.txt` | ~161k Hungarian words, duplicated in two places. |
| Legacy app | `streamlit_app.py`, `game_logic.py`, root `requirements.txt` | Old Streamlit version; logic duplicated from `backend/main.py` and already drifted. |
| Deploy | `.github/workflows/hf_sync.yml`, `backend/Dockerfile` | Push-to-main syncs backend to a Hugging Face Space (port 7860). Frontend deployment not in repo. |

**Core loop today:** backend picks a random word of length 7, sends the scrambled letters
(*and the solution, and the full list of findable words*) to the client; client submits
guesses; score = length²; 3-minute countdown runs in the browser; a "failed word"
reappearance system (weight multipliers) lives in backend process memory and is lost on
every restart.

---

## Architectural decisions (locked in for all batches)

These are decided once, here, so individual batches don't re-litigate them:

1. **Database: SQLite via SQLAlchemy 2.x + Alembic migrations.** Zero-ops, fits the
   HF-Space/single-container deployment, and the SQLAlchemy layer makes a later move to
   Postgres a connection-string change. Store the DB file at a path from `DATABASE_URL`
   env var (default `sqlite:///./betuveto.db`). *Do not* introduce Postgres/Redis until
   multiplayer (Batch 7) forces the question — and even then, probably not.
2. **Backend structure:** break `backend/main.py` into a package
   (`backend/app/{main,config,models,schemas,game,routers/,services/}.py`) in Batch 1.
   All later batches assume this layout.
3. **Identity: anonymous-first.** A signed, HTTP-only player cookie is the primary
   identity (Batch 2). Google OAuth is a later, optional *upgrade* that links to the same
   player record (Batch 8) — not a login wall. Nobody should ever be forced to sign in to play.
4. **Server-authoritative game state.** After Batch 1, the client never receives the
   target word or the solution list during an active game, and the server enforces the
   timer and computes all scores. The client-side timer becomes cosmetic.
5. **Language/wordlist model:** every game row references a `wordlist_id`; word data
   lives in a `words` table (`id, wordlist_id, word, length, active, source`), not in flat
   files at runtime. Flat files remain the *import* format (Batch 6 builds the importer;
   Batch 1 may keep file loading as a stopgap).
6. **Multiplayer transport: WebSockets** (FastAPI native), room-based, co-op. No
   third-party realtime service.
7. **Android: PWA → Trusted Web Activity (Bubblewrap)**, not a native rewrite. See the
   challenge notes in Batch 9.
8. **API versioning:** all new endpoints under `/api/v1/`; keep old paths as thin aliases
   until the frontend is migrated, then delete them.

---

## Batch 0 — Bug & security fixes (do first, no new features)

*Goal: the existing single-player game becomes correct, honest and safe to expose
publicly — without changing its feature set. Everything here is independently shippable.*

### 0.1 `[ ]` Stop leaking the solution to the client
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

### 0.2 `[ ]` Fix the shared-global-state hazard (interim mitigation)
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

### 0.3 `[ ]` CORS misconfiguration
- `allow_origins=["*"]` together with `allow_credentials=True` is an invalid and unsafe
  combination (and will actively break cookie auth in Batch 2).
- **Fix:** read allowed origins from env (`CORS_ORIGINS`, comma-separated; default
  `http://localhost:5173`). Keep `allow_credentials=True`.
- **Accept:** requests from unlisted origins are rejected; local dev still works.

### 0.4 `[ ]` Enforce the timer server-side
- The 180 s countdown exists only in React state; the API happily scores guesses forever.
- **Fix:** store `started_at` and `duration_seconds` per game; `/guess` rejects (with a
  clear `game_ended: true` payload) once expired. Return `ends_at` (epoch seconds) from
  `/start` so the client clock just renders it — this also fixes drift on tab-sleep.
- **Accept:** a guess sent 181 s after start scores 0 and reports the game ended,
  regardless of client behaviour.

### 0.5 `[ ]` Replace the "1-letter guess = reveal" hack
- `guess_word` treats any single-character guess as "give up and reveal" — an accidental
  single letter + Enter silently ends the game and marks the word as failed.
- **Fix:** dedicated `POST /api/game/give_up` endpoint; single-character guesses become a
  normal "too short" validation error (min length 3, see 0.6). Frontend: an explicit
  "Feladom" (give up) button behind a confirm.
- **Accept:** no guess input can end the game; give-up works via its own endpoint.

### 0.6 `[ ]` Minimum word length inconsistency (2 vs 3)
- `get_possible_words` counts words of length ≥ 3, but `/guess` accepts and scores any
  dictionary word ≥ 2 (frontend blocks only length < 2). Finding a valid 2-letter word
  breaks the found/total counter and the "all words found" bonus logic.
- **Fix:** single `MIN_WORD_LENGTH = 3` constant enforced in `/guess` and reflected in the
  frontend; message "Legalább 3 betűs szót adj meg."
- **Accept:** 2-letter guesses are rejected; `foundWords.length` can never exceed
  `possibleWordsCount`.

### 0.7 `[ ]` Validate `target_length` input
- `POST /api/game/start?target_length=...` accepts any int (also unbounded via the JSON
  body variant). **Fix:** FastAPI `Query(ge=5, le=10, default=7)` / pydantic
  `Field(ge=5, le=10)` — this also pre-builds the contract for Batch 2's length option.

### 0.8 `[ ]` Frontend robustness fixes
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

### 0.9 `[ ]` Repository hygiene
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
- Dockerfile: add a non-root user (`USER app`), pin the Python minor version, add a
  `HEALTHCHECK` hitting `/`.
- Add `LICENSE` file (decide: MIT for code; document wordlist licence separately).

### 0.10 `[ ]` Minimal test harness + CI
- pytest is already in `backend/requirements.txt` but there are zero tests.
- **Add:** `backend/tests/` with FastAPI `TestClient` covering: start→guess→score flow,
  can-form logic (including Hungarian accented letters ÁÉÍÓÖŐÚÜŰ and double letters),
  timer expiry, invalid `target_length`, unknown `game_id`. A GitHub Actions workflow
  (`ci.yml`) running `pytest` + `npm run lint` + `npm run build` on every PR.
- **Accept:** CI is green and required; every later batch adds tests to this harness.

---

## Batch 1 — Foundations: sessions, database, restructure

*Goal: the load-bearing refactor everything else depends on. No user-visible features,
but after this batch the app has real persistence and per-player state.*

### 1.1 `[ ]` Backend package restructure
- Split `backend/main.py` into `backend/app/` per the architecture section. Pure
  mechanical move + `config.py` reading all env vars in one place
  (pydantic-settings). Keep endpoints byte-compatible.

### 1.2 `[ ]` Introduce SQLite + SQLAlchemy + Alembic
- Tables (initial migration):
  - `players(id UUID pk, created_at, display_name nullable, cookie_token_hash, google_sub nullable unique, is_admin bool default false)`
  - `games(id UUID pk, player_id fk nullable, wordlist_id fk, target_word, target_length, started_at, ends_at, ended_at nullable, final_score, found_count, possible_count, status enum[active,finished,abandoned,given_up])`
  - `game_guesses(id, game_id fk, word, correct bool, score, created_at)` — needed later for review/anti-cheat and "words found" history.
  - `word_stats(player_id, word, times_failed, times_solved, last_failed_game_seq)` — replaces the in-memory `failed_words` dict, per player.
  - `wordlists(id, code e.g. 'hu', name, active)` and `words(id, wordlist_id, word, length, active bool default true, source enum[original,suggested], created_at)`.
- Importer script `backend/scripts/import_wordlist.py` loading `data/magyar-szavak.txt`
  into `words` (idempotent). Runtime keeps an in-memory `set` per wordlist for guess
  checks (161k words is fine in RAM) but *hydrated from the DB*, refreshable without restart.
- **Gotcha for the implementer:** normalise words `NFC` + uppercase on import and on
  guess; Hungarian `.upper()` is safe in Python but be explicit about Unicode
  normalisation so `Á` composed vs decomposed compare equal.

### 1.3 `[ ]` Persist games server-side
- Replace the Batch-0 in-memory game dict with the `games` table (+ small in-process
  cache for the hot set of active games). Restart no longer loses running games.
- The failed-word reappearance weighting moves to `word_stats` (per player once Batch 2
  lands; keyed to the anonymous cookie player).
- **Accept:** restart the backend mid-game; the client's next guess still works.

### 1.4 `[ ]` Deployment persistence check
- HF Spaces containers have ephemeral disks unless persistent storage is enabled.
  Document (README + `.env.example`) that `DATABASE_URL` must point at the Space's
  persistent `/data` mount, or migrate hosting (Fly.io/Railway/small VPS are all fine for
  this footprint). **Decide and document — a DB that vanishes on redeploy invalidates
  Batches 2–8.**

---

## Batch 2 — Player identity (cookie), server high scores, word-length option

### 2.1 `[ ]` Anonymous cookie identity
- On first API contact, backend mints a `player` row and sets a signed, `HttpOnly`,
  `SameSite=Lax`, `Secure` cookie (`itsdangerous` or JWT with a server secret from env).
  All game endpoints resolve the player from it. No UI, no consent friction — it's a
  device identity, like a save file.
- Optional display name: small "name yourself" input (stored on `players.display_name`,
  max 20 chars, strip/validate; profanity filtering is out of scope — admin can edit in Batch 5).
- **Challenge to the original idea:** *don't start with Google OAuth.* It adds a consent
  screen, GCP project, redirect-URI config per environment, and token handling — for zero
  gameplay value at this stage. Cookie identity delivers per-player scores/stats
  immediately; OAuth arrives in Batch 8 purely as "keep my progress across devices".

### 2.2 `[ ]` Server-side high scores
- `GET /api/v1/scores/top?length=7&wordlist=hu&period=all|week|day` → top N
  (score, display_name, date). Written automatically when a game finishes (server
  computes final score — client totals are never trusted).
- Frontend: high-score panel (there is already a hidden/commented block in `App.jsx`);
  show global top 10 + "your best". Keep the existing localStorage scores as a fallback
  display until this ships, then delete that code.
- **Anti-cheat baseline (cheap, do now):** scores only from server-recorded guesses;
  rate-limit `/guess` (e.g. 3/s per player, `slowapi`) so dictionary-dump bots don't own
  the board. Perfect anti-cheat is explicitly out of scope.

### 2.3 `[ ]` Word length option (5–10)
- Backend already parametrised after 0.7. Frontend: a length selector on the
  new-game modal/start screen (default 7, persisted per player in DB `players.preferred_length`).
- High scores are **per length** (a 10-letter board yields far more points — never mix boards).
- Timer scales with length: suggest `duration = 120 + 15 × (length − 5)` seconds
  (config values, admin-editable in Batch 5).
- **Accept:** each length 5–10 has words available (verify against the wordlist and hide
  lengths with < 500 candidate words), separate leaderboards render correctly.

---

## Batch 3 — Gameplay depth: hints, totals & bonus, stats

### 3.1 `[ ]` Hint option (at a cost)
- Design (keep it simple, one hint type first):
  - `POST /api/v1/game/{id}/hint` reveals the **first letter of one random unfound word**
    (prefer longer words). Response: `{letter, position: 1, word_length, cost}`.
  - Cost: deduct `hint_cost` points (default 10, config) from the running score; floor at 0.
    Alternative costs (time penalty, limited hint count) are config knobs, not new code paths.
  - Record hints in a `game_hints` table (needed for fair leaderboards).
- Leaderboard policy: hinted games still count, but show a 💡 marker; keep it simple —
  a separate "pure" board is a config toggle for later, not a launch requirement.
- Frontend: hint button with cost label, disabled when score < cost or no unfound words.

### 3.2 `[ ]` Total word count + completion bonus (server-side)
- The client already shows found/total and grants `+timeLeft` bonus — but computes it
  locally. Move to server: when `found_count == possible_count`, server ends the game and
  adds `remaining_seconds × completion_multiplier` (default 1) bonus. Return the final
  breakdown so the UI can celebrate honestly.
- Show possible-count per game start (from 0.1's count endpoint).

### 3.3 `[ ]` Player stats page (small, high-value)
- `GET /api/v1/me/stats`: games played, average score per length, longest word found,
  completion rate, personal failed-words list (server-side now, from `word_stats` —
  replaces the localStorage "Előzmények" feature; migrate then delete the local version).

---

## Batch 4 — Community word curation (flag wrong / suggest missing)

*Rationale: with a 161k-word scraped list, curation is the highest-leverage quality
feature for a Hungarian word game. Ship it before the admin UI so the queue has content.*

### 4.1 `[ ]` Flag an accepted word as wrong
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

### 4.2 `[ ]` Suggest a missing word
- After a rejected guess ("Nem ismerek ilyen szót"), offer "Szerinted létező szó?
  Beküldöm" → `POST /api/v1/words/suggest {word, wordlist}`.
- Inserts into `words` with `active=false, source='suggested'` + a row in
  `word_suggestions(word_id, player_id, created_at, status)`. Validation: length 3–15,
  Hungarian alphabet only, not already present (case/NFC-normalised).
- Rate-limit: max 10 suggestions/player/day.
- Optional delight: when an admin approves a suggestion, the suggesting player sees a
  "your word was added!" toast on next visit (a `notifications` table, or defer).

---

## Batch 5 — Admin interface

### 5.1 `[ ]` Admin auth & shell
- `players.is_admin` flag (set manually in DB for the first admin). Admin endpoints under
  `/api/v1/admin/*` guarded by a dependency checking the flag; **admins must log in via
  Google OAuth once Batch 8 lands — until then, a long random admin token in env
  (`ADMIN_TOKEN`) sent as a header is acceptable and simple.**
- UI: a separate route in the existing React app (`/admin`), not a separate deployment.
  Plain tables and forms; do not add a component library for this.

### 5.2 `[ ]` Admin features (in priority order)
1. **Word review queue:** open reports and suggestions; approve/reject; reactivate
   auto-inactivated words; edit/delete words; search the wordlist.
2. **Config editor:** the constants currently hardcoded in `main.py`
   (`FAIL_PROB_INITIAL_MULTIPLIER`, hint cost, timer formula, min word length, rate
   limits) move to a `config` table with typed defaults; admin edits take effect without
   redeploy.
3. **Score/player maintenance:** view players, edit/delete suspicious leaderboard
   entries, rename inappropriate display names, merge duplicate players (cookie + OAuth).
4. **Dashboard:** games/day, DAU, most-failed words, report queue size.
- **Audit:** every admin mutation writes to `admin_audit_log(admin_id, action, payload, created_at)`.

---

## Batch 6 — Internationalisation: English (and the door to more languages)

### 6.1 `[ ]` Wordlist plumbing (mostly done in Batch 1 schema)
- Add `en` wordlist. **Source & licence matter:** use a public-domain/free list —
  ENABLE (public domain) or SCOWL (permissive) are the standard choices; filter to 3–15
  letters, lowercase-only entries (drops proper nouns), no diacritics. Document the
  choice and licence in `data/README.md`. Also *verify and document the licence of the
  existing Hungarian list* — currently unstated in the repo.
- Language selector on the start screen; game rows already carry `wordlist_id`;
  leaderboards are per wordlist+length (already keyed that way from Batch 2).

### 6.2 `[ ]` UI string i18n
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

### 6.3 `[ ]` Further languages (design note, no build work)
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
- WebSocket `/ws/room/{code}`: server pushes `player_joined`, `game_started`
  (scrambled letters + ends_at), `progress_update {player, found_count, score}` on every
  correct guess, `game_over {full reveal: per-player word lists, remaining words}`.
  Guesses still go over the existing REST endpoint (simpler; WS is push-only) — the
  guess handler just also broadcasts.
- Frontend: lobby screen (create/join with code), in-game opponent progress sidebar,
  end-of-game comparison view.
- **Gotchas to write into the task:** reconnection (client rejoins WS with room code and
  player cookie; server resends full room snapshot); room TTL/cleanup; cap room size
  (e.g. 8); single-process WS is fine — do **not** add Redis pub/sub unless the app
  outgrows one instance.
- **Suggested cheap precursor (consider shipping as 7.0):** a **daily puzzle** — same
  word for everyone each day, with a daily leaderboard. ~10% of the effort, delivers much
  of the social value, and creates a retention loop. Reuses everything from Batch 2.

---

## Batch 8 — Google OAuth (identity upgrade) 

### 8.1 `[ ]` OAuth linking
- "Sign in with Google" (Authorization Code + PKCE via backend; store only `google_sub`,
  email optional). On login, **link to the current cookie player** (set `google_sub` on
  the existing row) so history/scores are kept. On a new device, logging in resolves to
  the linked player — cross-device continuity is the entire point of this batch.
- Merge rule: if the current device's anonymous player has games *and* the Google
  account already maps to another player, merge stats into the OAuth player (keep both
  game histories; `word_stats` rows merge additively) — write this as an explicit,
  tested service function; it's the fiddliest part.
- Admin login switches from `ADMIN_TOKEN` header to OAuth (`is_admin` on the linked player).
- Keep anonymous play fully functional forever.

---

## Batch 9 — Android app

### 9.1 `[ ]` PWA hardening first
- `vite-plugin-pwa` is configured but the manifest references `pwa-192x192.png` /
  `pwa-512x512.png` that **do not exist in `frontend/public/`** — create real icons
  (+ maskable variants), add offline fallback page, verify Lighthouse PWA pass,
  add install prompt UX.

### 9.2 `[ ]` Play Store via Trusted Web Activity
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

## Batch 10 — Backlog / ideas (unordered; pull into batches as desired)

- `[ ]` **Daily puzzle + streaks** (see 7.2 note — arguably belongs before multiplayer).
- `[ ]` **Difficulty rating per word** — % of games where the target was found; feed back
  into word selection ("easy mode" picks well-known words). Data starts accruing the
  moment Batch 1 lands, so log now, build later.
- `[ ]` **Spaced-repetition polish** — the failed-word reappearance system is a genuinely
  distinctive learning feature; once server-side (Batch 1), expose it: "words you're
  practising" panel, per-word progress.
- `[ ]` **Achievements** (first 10-letter word, 7-day streak, full clear without hints…).
- `[ ]` **Accessibility pass** — the letter buttons and animations need ARIA labels,
  focus order, reduced-motion support (`prefers-reduced-motion` for confetti/shake).
- `[ ]` **Sound effects + toggle.**
- `[ ]` **Dark mode** (Tailwind `dark:` variants; persist per player).
- `[ ]` **Definition lookup** — link found/missed words to a dictionary (e.g. Wiktionary)
  at game end; big learning value, trivial to add.
- `[ ]` **Privacy page + data deletion endpoint** — required once accounts/OAuth exist
  (GDPR: you're storing EU-user data); `DELETE /api/v1/me` wipes the player row and
  anonymises games.
- `[ ]` **Observability** — structured logging + error tracking (Sentry free tier) before
  multiplayer debugging is needed.
- `[ ]` **Frontend refactor** — `App.jsx` is a 640-line single component; when Batch 2's
  UI work starts, split into `components/` (Board, GuessInput, Timer, Scoreboard,
  Modal…) and a `useGame` hook. Do it *as part of* that batch, not as a standalone
  "refactor everything" task (those go badly with AI implementers — always pair
  refactors with a feature that exercises them).
- `[ ]` **E2E smoke test** — one Playwright test (start game → guess a word → see score)
  in CI; catches the "white screen" class of regressions that has already happened once
  in this repo's history.

---

## Challenged / rejected ideas (and why)

| Original idea | Verdict | Reasoning |
|---|---|---|
| Google OAuth as primary identity | **Deferred to Batch 8** | Cookie identity delivers per-player features with zero friction; OAuth is a cross-device *upgrade*, not a gate. |
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
| 1 — Foundations | M–L | 0 |
| 2 — Identity + scores + length | M | 1 |
| 3 — Hints + bonus + stats | S–M | 2 |
| 4 — Word curation | M | 2 |
| 5 — Admin | M | 4 |
| 6 — English / i18n | M | 1 (2 for prefs) |
| 7 — Multiplayer | L–XL | 0–3 |
| 8 — Google OAuth | M | 2 |
| 9 — Android (TWA) | S–M | stable deploy |
| 10 — Backlog | à la carte | varies |

**Working agreement for AI-assisted delivery:** one batch item = one PR; every PR adds or
updates tests in `backend/tests/`; every PR updates the checkbox here. Batches 0 and 1
must not be parallelised with anything else.
