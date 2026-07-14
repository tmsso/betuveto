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

---

## Architectural decisions (locked in for all batches)

These are decided once, here, so individual batches don't re-litigate them:

1. **Hosting: Vercel + Supabase (both free tier).** The frontend (static build) and the
   game API (TypeScript serverless functions) live on Vercel — the frontend already
   deploys there. Postgres, Auth and Realtime come from one Supabase free-tier project.
   The Hugging Face Space and `hf_sync.yml` are retired at the end of Batch 1.
   *Rationale:* free HF Spaces have ephemeral disks (no local DB), sleep after ~48 h with
   slow cold starts, and offer no custom domain (needed for the Android TWA in Batch 9);
   once the database is external anyway, HF is just a slow free Python host.
2. **Backend language: TypeScript.** Batch 1 ports the ~320-line FastAPI app to Vercel
   API routes (`api/` directory). One-time cost, paid exactly when the backend was due a
   restructure anyway; afterwards the whole stack speaks one language and the platform's
   Auth/Realtime SDKs are first-class. The Python backend (`backend/`) is deleted once
   the port is verified against the Batch 0 contract tests.
3. **Database: Supabase Postgres.** Schema managed as SQL migrations via the Supabase CLI
   (`supabase/migrations/`). Serverless functions connect through the pooled connection
   (Supavisor) or `supabase-js` — never direct per-invocation Postgres connections.
   Row Level Security is enabled deny-all on every table; all game logic runs in Vercel
   functions holding the service-role key, so no table containing answers is ever
   client-readable. Direct client reads can be opened table-by-table later if profitable.
4. **Identity: anonymous-first via Supabase Auth.** Anonymous sign-in (built into
   Supabase) is the primary identity (Batch 2). Google OAuth arrives later (Batch 8) as
   an *identity link* on the same user — an upgrade for cross-device continuity, never a
   login wall. Nobody should ever be forced to sign in to play.
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
7. **Multiplayer transport: Supabase Realtime** (broadcast + presence channels), room-based,
   co-op. Vercel functions cannot host WebSocket servers; Realtime fills that gap —
   guesses still go over REST, and the API route broadcasts progress to the room channel.
8. **Android: PWA → Trusted Web Activity (Bubblewrap)**, not a native rewrite. See the
   challenge notes in Batch 9.
9. **API versioning:** all new endpoints under `/api/v1/`; keep old paths as thin aliases
   until the frontend is migrated, then delete them.
10. **Free-tier operating notes (know these, don't fight them):**
    - Supabase free projects **pause after 7 days of inactivity** — Batch 1 adds a weekly
      keep-alive cron (GitHub Actions or Vercel cron) that pings the DB.
    - Vercel Hobby is **non-commercial** — fine for a free game; revisit on monetisation.
    - The function timeout (10 s default) is the compute budget — hence the signature
      design in (6); no endpoint may scan the full wordlist per request.
    - Supabase Realtime free tier: 200 concurrent connections, 2M messages/month — ample
      at hobby scale, but keep messages coarse (progress updates, never keystrokes).

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

## Batch 1 — Foundations: port to Vercel + Supabase

*Goal: the load-bearing migration everything else depends on. No user-visible features,
but after this batch the app runs on the target architecture with real persistence, and
the HF Space is gone. Requires Batch 0 (especially 0.10's contract tests) to be done first.*

### 1.1 `[x]` Supabase project + schema
- Create the Supabase project; commit SQL migrations (`supabase/migrations/`) for:
  - `players(id UUID pk references auth.users, created_at, display_name nullable, is_admin bool default false, preferred_length int nullable)`
  - `games(id UUID pk, player_id fk nullable, wordlist_id fk, target_word, target_length, started_at, ends_at, ended_at nullable, final_score, found_count, possible_count, status enum[active,finished,abandoned,given_up])`
  - `game_guesses(id, game_id fk, word, correct bool, score, created_at)` — needed later for review/anti-cheat and "words found" history.
  - `word_stats(player_id, word, times_failed, times_solved, last_failed_game_seq)` — replaces the in-memory `failed_words` dict, per player.
  - `wordlists(id, code e.g. 'hu', name, active)` and `words(id, wordlist_id, word, length, signature, active bool default true, source enum[original,suggested], created_at)` — index on `(wordlist_id, signature)` and `(wordlist_id, length, active)`.
- **RLS enabled deny-all on every table** — the API routes use the service-role key and
  bypass it; the client gets no direct table access in this batch.
- Importer script `scripts/import-wordlist.ts` loading `data/magyar-szavak.txt` into
  `words` (idempotent batch upserts), computing `signature` (sorted letters) per word.
- **Gotcha for the implementer:** normalise words to `NFC` + uppercase on import **and**
  on every guess (`word.normalize('NFC').toUpperCase()`), so composed vs decomposed `Á`
  compare equal; Hungarian uppercasing is locale-safe in JS but be explicit about NFC.

### 1.2 `[ ]` Port the API to TypeScript Vercel functions
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

### 1.3 `[ ]` Frontend cutover + retire the Python stack
- Frontend and API are now same-origin: drop `VITE_API_BASE_URL` plumbing and the Vite
  dev proxy in favour of `vercel dev` (update `run_dev.sh` accordingly); delete the
  `/api/game/start/body` fallback if 0.8 hasn't already.
- Delete `backend/`, `hf_sync.yml` and the HF Space itself once the Vercel deployment is
  verified. Update README/`.env.example` for the new stack (Supabase URL + anon key +
  service-role key as Vercel env vars — **service-role key is server-only, never in
  `VITE_*`**).

### 1.4 `[ ]` Free-tier keep-alive + ops
- Weekly cron (GitHub Actions or Vercel cron) hitting a tiny `/api/v1/health` route that
  performs one DB read — prevents the Supabase 7-day inactivity pause.
- Document the restore path: Supabase free tier keeps limited backups; add a monthly
  `pg_dump` via GitHub Actions to a private artifact if the score data starts mattering.

---

## Batch 2 — Player identity (anonymous), server high scores, word-length option

### 2.1 `[ ]` Anonymous identity via Supabase Auth
- On first visit the frontend calls `supabase.auth.signInAnonymously()` (enable it in the
  Supabase dashboard); `supabase-js` persists and refreshes the session automatically.
  API routes verify the JWT (sent as a `Authorization: Bearer` header) and resolve or
  create the matching `players` row from the user id. No UI, no consent friction — it's
  a device identity, like a save file.
- Optional display name: small "name yourself" input (stored on `players.display_name`,
  max 20 chars, strip/validate; profanity filtering is out of scope — admin can edit in Batch 5).
- **Challenge to the original idea:** *don't start with Google OAuth.* It adds a consent
  screen, GCP project and redirect-URI config for zero gameplay value at this stage.
  Anonymous identity delivers per-player scores/stats immediately; OAuth arrives in
  Batch 8 as a ~10-line *identity link* on the same user ("keep my progress across devices").

### 2.2 `[ ]` Server-side high scores
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
- `players.is_admin` flag (set manually in DB for the first admin — the Supabase
  dashboard's table editor also covers emergency data fixes until this batch ships).
  Admin endpoints under `/api/v1/admin/*` guarded by a check on the flag; **admins must
  log in via Google OAuth once Batch 8 lands — until then, a long random admin token in
  env (`ADMIN_TOKEN`) sent as a header is acceptable and simple.**
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
   entries, rename inappropriate display names, merge duplicate players (anonymous + OAuth).
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
- **Supabase Realtime** channel `room:{code}` (private channel, membership-authorised):
  clients subscribe with `supabase-js`; **presence** tracks who's in the lobby; the guess
  API route broadcasts (via the service-role Realtime client) `game_started` (scrambled
  letters + ends_at), `progress_update {player, found_count, score}` on every correct
  guess, and `game_over {full reveal: per-player word lists, remaining words}`. Guesses
  still go over REST (Realtime is push-only here) — the guess handler just also broadcasts.
- Frontend: lobby screen (create/join with code), in-game opponent progress sidebar,
  end-of-game comparison view.
- **Gotchas to write into the task:** reconnection (client re-subscribes to the channel
  and GETs a room-snapshot endpoint to resync); room TTL/cleanup; cap room size (e.g. 8);
  keep broadcasts coarse — the free tier is 2M messages/month; authorise channel access
  so only room members can subscribe (Realtime authorisation policies).
- **Suggested cheap precursor (consider shipping as 7.0):** a **daily puzzle** — same
  word for everyone each day, with a daily leaderboard. ~10% of the effort, delivers much
  of the social value, and creates a retention loop. Reuses everything from Batch 2.

---

## Batch 8 — Google OAuth (identity upgrade) 

### 8.1 `[ ]` Google sign-in via Supabase identity linking
- "Keep my progress" button calls `supabase.auth.linkIdentity({provider: 'google'})` on
  the current anonymous user — history and scores are kept automatically because the user
  id doesn't change. On a new device, `signInWithOAuth({provider: 'google'})` resolves to
  the already-linked user — cross-device continuity is the entire point of this batch.
  (One-time setup: GCP OAuth client + enabling the Google provider in Supabase.)
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

### 9.1 `[ ]` PWA hardening first
- `vite-plugin-pwa` is configured but the manifest references `pwa-192x192.png` /
  `pwa-512x512.png` that **do not exist in `frontend/public/`** — create real icons
  (+ maskable variants), add offline fallback page, verify Lighthouse PWA pass,
  add install prompt UX.

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
| Backend on HF Space | **Replaced with Vercel + Supabase (Batch 1)** | Free HF has ephemeral disk (no DB), ~48 h sleep with slow cold starts, no custom domain (blocks the Batch 9 TWA). Once the DB is external anyway, HF is just a slow Python host; the port cost is one small file, paid during a batch that was restructuring it anyway. |
| Google OAuth as primary identity | **Deferred to Batch 8** | Anonymous identity delivers per-player features with zero friction; OAuth is a cross-device *upgrade*, not a gate — and Supabase identity linking makes it ~10 lines. |
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
| 1 — Foundations (Vercel + Supabase port) | M–L | 0 |
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
