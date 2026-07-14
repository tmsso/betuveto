/**
 * Postgres access for the Vercel functions.
 *
 * The Vercel–Supabase connector injects POSTGRES_URL (the pooled connection); we fall
 * back to DATABASE_URL so the same code runs from a local shell and from the tests.
 *
 * Two settings matter and are not defaults:
 *   - `prepare: false` — Supabase's pooler runs pgBouncer in transaction mode, which
 *     cannot hold named prepared statements across statements in a pool.
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

let wordlistIdCache: { code: string; id: number } | null = null;

/** Cached per warm instance — the id never changes for a given code. */
export async function wordlistId(code: string = DEFAULT_WORDLIST_CODE): Promise<number> {
  if (wordlistIdCache?.code === code) return wordlistIdCache.id;

  const sql = db();
  const [row] = await sql<{ id: number }[]>`
    select id from wordlists where code = ${code} and active
  `;
  if (!row) throw new Error(`Wordlist '${code}' not found. Run: npm run db:import`);

  wordlistIdCache = { code, id: row.id };
  return row.id;
}
