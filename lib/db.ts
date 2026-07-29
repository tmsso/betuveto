/**
 * Postgres access for the Vercel functions (Neon).
 *
 * The Vercel–Neon integration injects POSTGRES_URL (the pooled connection); we fall back
 * to DATABASE_URL so the same code runs from a local shell and from the tests.
 *
 * Two settings matter and are not defaults:
 *   - `prepare: false` — use Neon's *pooled* endpoint, which runs PgBouncer in transaction
 *     mode; it cannot hold named prepared statements across statements in a pool.
 *   - a small `max` — every concurrent serverless invocation opens its own pool, so a
 *     large per-instance pool multiplies into the connection limit under load.
 */
import postgres, { type Sql } from "postgres";

let client: Sql | null = null;

export function db(): Sql {
  if (client) return client;

  const url = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error("No database URL: set POSTGRES_URL (Vercel) or DATABASE_URL (local).");
  }

  client = postgres(url, {
    prepare: false,
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  });
  return client;
}

/** The wordlist a game is played against. One per language; 'hu' is the only one until Batch 6. */
export const DEFAULT_WORDLIST_CODE = "hu";

interface WordlistMeta {
  id: number;
  alphabet: string;
}

// One entry per code, not just the last-seen one — with a second live wordlist (Batch
// 6.1), requests for 'hu' and 'en' interleave within the same warm instance, and a
// single-slot cache would evict and miss on every call instead of ever hitting.
const wordlistCache = new Map<string, WordlistMeta>();

async function loadWordlistMeta(code: string): Promise<WordlistMeta> {
  const cached = wordlistCache.get(code);
  if (cached) return cached;

  const sql = db();
  const [row] = await sql<WordlistMeta[]>`
    select id, alphabet from wordlists where code = ${code} and active
  `;
  if (!row) throw new Error(`Wordlist '${code}' not found. Run: npm run db:import`);

  wordlistCache.set(code, row);
  return row;
}

/** Cached per warm instance — the id never changes for a given code. */
export async function wordlistId(code: string = DEFAULT_WORDLIST_CODE): Promise<number> {
  return (await loadWordlistMeta(code)).id;
}

/** Accepted on-screen-keyboard/suggestion letters for this language (ROADMAP 6.1/6.2) —
 *  e.g. "ABCDEFGHIJKLMNOPQRSTUVWXYZ" for en, replacing what used to be a Hungarian-only
 *  hardcoded whitelist. */
export async function wordlistAlphabet(code: string = DEFAULT_WORDLIST_CODE): Promise<string> {
  return (await loadWordlistMeta(code)).alphabet;
}
