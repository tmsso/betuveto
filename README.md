# Betűvető — Hungarian Word Game

Form as many valid Hungarian words as you can from a set of scrambled letters
before the timer runs out. Longer words score more (points = word length²), and
finding every possible word clears the board.

## Stack

- **Frontend:** React 19 + Vite 7 + Tailwind CSS 3 (PWA-enabled)
- **API:** TypeScript Vercel serverless functions, server-authoritative, no in-process state
- **Database:** Neon serverless Postgres
- **Dictionaries:** ~161k Hungarian words (`data/magyar-szavak.txt`) and ~270k English
  words (`data/english-words.txt`) — see [Word lists](#word-lists) below

> A batch-by-batch plan for where this project is headed (accounts, multiplayer, i18n,
> admin tools, Android) lives in [`ROADMAP.md`](./ROADMAP.md). Realtime (Ably) arrives
> once multiplayer lands (Batch 7).

## Development setup

Requirements: Node 18+, the [Vercel CLI](https://vercel.com/docs/cli) (`npm i -g vercel`,
then `vercel login` and `vercel link` once to connect this checkout to the Vercel project).

```bash
npm install                       # root tooling: API, migrations, tests
npm --prefix frontend install     # frontend deps

./run_dev.sh                      # `vercel dev` — frontend + api/ on one origin
```

Frontend and API are same-origin under `vercel dev` (it runs the Vite dev server declared
as `devCommand` in `vercel.json` and proxies non-`/api` requests to it), so there is no
CORS or dev-proxy configuration to maintain. `vercel dev` also pulls the linked project's
**Development** environment variables automatically — set them in the Vercel dashboard
(or `vercel env add ... development`) rather than duplicating them locally.

### Configuration

See [`.env.example`](./.env.example) for `DATABASE_URL` (needed locally to run
`db:migrate`/`db:import`/`db:verify` directly, outside of `vercel dev`) and the contract
test's `API_BASE_URL`/`VERCEL_AUTOMATION_BYPASS_SECRET`.

## API (Vercel functions)

The TypeScript API that replaces the Python backend (ROADMAP Batch 1.2). It is
server-authoritative and holds **no in-process state**: every game lives in the `games`
table and every scored guess in `game_guesses`, so any function instance can serve any
request and a redeploy mid-game loses nothing.

- `api/v1/…` — one thin handler per endpoint (10 functions, including `health` — a cheap
  DB read for uptime checks, ROADMAP 1.4).
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
API_BASE_URL=https://<preview>.vercel.app npm test
# ...and if Vercel deployment protection is on:
API_BASE_URL=… VERCEL_AUTOMATION_BYPASS_SECRET=… npm test
```

## Database (Neon)

The target architecture (ROADMAP Batch 1) puts persistence on **Neon** serverless Postgres
(Neon also provides the auth in Batch 2). Schema lives as SQL migrations in
[`migrations/`](./migrations); the dictionary is loaded into the `words` table (each row
stores a `signature` — its letters sorted — so possible-words is one indexed query rather
than a full scan).

> **Status:** the schema, importer and API were first built on Supabase (#9, #10) and
> re-pointed to Neon in ROADMAP Batch 1.5 — plain-SQL migrations in `migrations/`, a
> `db:migrate` runner, and a single `DATABASE_URL` (no Supabase CLI or `SUPABASE_*` vars).
> Live and verified against a Neon project: 155,107 words imported, `db:verify` green.

```bash
npm install                       # repo-root tooling (importer, migration runner)

# Validate the importer's parsing/normalisation without any database:
npm run db:import -- --dry-run

# Apply migrations + import the wordlist to the CLOUD database (set DATABASE_URL to the
# Neon pooled connection string first — see .env.example):
npm run db:migrate                # apply migrations/*.sql (tracked in schema_migrations)
npm run db:import

# Check the deployed database: schema, row counts, and that the signature lookup returns
# the right words via the index rather than a full scan.
npm run db:verify
```

> **Connection:** put Neon's **pooled** connection string in `DATABASE_URL`
> (`...-pooler.<region>.aws.neon.tech`, dual-stack) — same `postgres` (postgres.js) driver
> as the Supabase build, no swap needed. `prepare: false` stays required: Neon's pooler is
> also PgBouncer in transaction mode.

## Tests

```bash
npm test                                      # API unit tests (no database needed)
cd frontend && npm run lint && npm run build  # frontend checks
```

CI runs all of the above on every pull request (`.github/workflows/ci.yml`).

## Deployment

Vercel builds and deploys the whole app (frontend + `api/`) from its GitHub integration on
every push — there is no separate backend deployment.

## Word lists

Two dictionaries as of ROADMAP Batch 6.1: `data/magyar-szavak.txt` (`hu`) and
`data/english-words.txt` (`en`), each imported with
`npm run db:import -- <file> --code <code> --name <name>`. Provenance and licence for
each are documented in [`data/README.md`](./data/README.md) — the Hungarian list's remain
unverified (a pre-existing TODO, still open); the English list is MIT-licensed and fully
attributed there.

## License

Code is released under the MIT License — see [`LICENSE`](./LICENSE). Word list licences
are tracked separately (see [`data/README.md`](./data/README.md)).
