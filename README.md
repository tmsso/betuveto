# Betűvető — Hungarian Word Game

Form as many valid Hungarian words as you can from a set of scrambled letters
before the timer runs out. Longer words score more (points = word length²), and
finding every possible word clears the board.

## Stack

- **Frontend:** React 19 + Vite 7 + Tailwind CSS 3 (PWA-enabled)
- **Backend:** FastAPI (Python 3.10+), in-memory game state keyed per game
- **Dictionary:** ~161k Hungarian words (`data/magyar-szavak.txt`)

> A batch-by-batch plan for where this project is headed (persistence, accounts,
> multiplayer, i18n, admin tools, Android) lives in [`ROADMAP.md`](./ROADMAP.md).
> The target architecture is Vercel + Supabase; the current FastAPI backend is
> the interim implementation.

## Development setup

Requirements: Python 3.10+, Node 18+.

```bash
# 1. Backend
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# 2. Frontend (in a second terminal)
cd frontend
npm install
npm run dev -- --host
```

Or run both at once from the repo root:

```bash
./run_dev.sh   # expects backend/venv to exist
```

The frontend dev server proxies `/api` to `http://localhost:8000`.

### Configuration

See [`.env.example`](./.env.example). Key variables:

- `CORS_ORIGINS` — comma-separated allowlist of browser origins (no wildcard;
  the API sends credentials).
- `WORDLIST_PATH` — path to the word list (defaults to `data/magyar-szavak.txt`).
- `VITE_API_BASE_URL` — API base for the frontend (defaults to `/api`).

## API (Vercel functions)

The TypeScript API that replaces the Python backend (ROADMAP Batch 1.2). It is
server-authoritative and holds **no in-process state**: every game lives in the `games`
table and every scored guess in `game_guesses`, so any function instance can serve any
request and a redeploy mid-game loses nothing.

- `api/v1/…` — one thin handler per endpoint (9 functions).
- `lib/` — the logic they share: `words.ts` (board/letter rules), `game.ts` (the game),
  `db.ts` (Postgres), `http.ts` (the Vercel adapter). The importer in `scripts/` reads its
  rules from `lib/words.ts` too, so the API and the dictionary can never disagree about
  what a word's letters are.
- `vercel.json` rewrites the pre-1.2 paths (`/api/game/…`, `/api/words/…`) onto `/api/v1/…`
  so the current frontend keeps working until the cutover in 1.3. Rewrites are free;
  duplicating the handlers would have doubled the function count against the Hobby limit.

> The Vercel project's **Root Directory must be `./`** (the repo root), not `frontend`.
> Vercel reads `vercel.json` from the Root Directory, and the functions in `api/` and the
> shared code in `lib/` live above `frontend/`.

Possible-words is computed once at game start from the board's letters — enumerate the
sub-multisets of its signature (~99 for a 7-letter board) and do one indexed
`signature = any(…)` lookup, rather than scanning all 155k words.

```bash
npm test          # unit tests (board/letter rules) — no database needed
npm run typecheck

# The full HTTP contract suite against a deployment (ports backend/tests/test_api.py):
BASE_URL=https://<preview>.vercel.app npm test
# ...and if Vercel deployment protection is on:
BASE_URL=… VERCEL_AUTOMATION_BYPASS_SECRET=… npm test
```

## Database (Supabase)

The target architecture (ROADMAP Batch 1) moves persistence to Supabase Postgres.
Schema lives as SQL migrations under [`supabase/migrations/`](./supabase/migrations);
the dictionary is loaded into the `words` table (each row stores a `signature` — its
letters sorted — so possible-words is one indexed query rather than a full scan).

```bash
npm install                       # repo-root tooling (Supabase CLI, importer)

# Validate the importer's parsing/normalisation without any database:
npm run db:import -- --dry-run

# Apply migrations + import the wordlist to the CLOUD project (set DATABASE_URL to
# the Supabase connection string first — see .env.example):
npm run supabase -- db push
npm run db:import

# Check the deployed database: schema, RLS, row counts, and that the signature
# lookup returns the right words via the index rather than a 155k-row scan.
npm run db:verify
```

> **Use the pooler connection string**, not the direct one. Supabase's direct host
> (`db.<ref>.supabase.co`) resolves to an IPv6 address only, so it is unreachable from an
> IPv4-only network and connections just time out. The transaction pooler
> (`aws-0-<region>.pooler.supabase.com:6543`) is dual-stack; the importer sets
> `prepare: false` so it works through pgBouncer. If the CLI cannot reach the direct host
> either, apply the migration by pasting it into the dashboard's SQL Editor.

> **Do not run a local Supabase stack** (`supabase start`) on a resource-constrained
> machine — it launches ~10 containers. Apply and validate against the hosted project.

## Tests

```bash
cd backend && pip install -r requirements.txt && pytest      # backend API tests
cd frontend && npm run lint && npm run build                 # frontend checks
```

CI runs all of the above on every pull request (`.github/workflows/ci.yml`).

## Deployment

`.github/workflows/hf_sync.yml` syncs the `backend/` directory (plus the
root `data/`) to a Hugging Face Space on every push to `main`. The frontend is
deployed via Vercel's GitHub integration.

## Word list

`data/magyar-szavak.txt` is the single source of truth for the dictionary
(one word per line). **TODO:** confirm and document the source and licence of
this list before public distribution.

## License

Code is released under the MIT License — see [`LICENSE`](./LICENSE). The word
list's licence is tracked separately (see above).
