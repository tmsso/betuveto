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
