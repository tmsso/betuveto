# Betűvető Frontend

React + Vite frontend for the Betűvető Hungarian word game.

## Local development

```bash
npm install
npm run dev
```

Frontend runs on `http://localhost:5173` by default.

## Backend connection

The app uses `VITE_API_BASE_URL` to determine the API URL.

- If set, requests are sent to `${VITE_API_BASE_URL}`.
- If unset, it falls back to `/api` (recommended for local dev through the Vite proxy).

For local development with Vite proxy, `/api` requests are forwarded to `http://localhost:8000`.

## Available scripts

```bash
npm run dev
npm run build
npm run preview
npm run lint
```

## Deployment notes

- Vercel frontend deployments should set `VITE_API_BASE_URL` to the deployed backend API base URL (including `/api`).
- Keep the backend CORS origin list aligned with frontend deployment domains.
