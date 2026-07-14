/**
 * Import a flat wordlist file into the Supabase `words` table (ROADMAP Batch 1.1).
 *
 * Idempotent: safe to re-run. Existing words are updated in place (length/signature
 * recomputed); their `active`/`source` are left untouched so curation (Batch 4/5) is
 * never undone by a re-import.
 *
 * Normalisation (must stay identical to the board-signature logic the API uses in
 * Batch 1.2): each word is trimmed, NFC-normalised, uppercased. Its `signature` is the
 * letters sorted by code point — matching the letter-by-letter, digraph-agnostic
 * matching the game has always used (ROADMAP decision 6.3).
 *
 * Usage (point DATABASE_URL at the CLOUD Supabase project — never a locally-hosted
 * stack). Prefer the *pooler* connection string from the Supabase dashboard: the direct
 * host (db.<ref>.supabase.co) is IPv6-only, so it is unreachable from IPv4-only networks.
 *
 *   DATABASE_URL='postgresql://postgres.<ref>:...@aws-0-<region>.pooler.supabase.com:6543/postgres' \
 *     npm run db:import -- [path/to/wordlist.txt] [--code hu] [--name "Magyar"]
 *
 *   # Validate parsing/normalisation without any database:
 *   npm run db:import -- --dry-run
 *
 * Defaults: file = data/magyar-szavak.txt, code = hu, name = Magyar.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import postgres from "postgres";
// The API scores guesses against the same rules the importer stores rows by, so both
// read them from one place — a divergence here would silently make words unfindable.
import { letterCount, normalizeWord, signatureOf } from "../lib/words.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const BATCH_SIZE = 2000;

export interface Args {
  file: string;
  code: string;
  name: string;
  dryRun: boolean;
}

export function parseArgs(argv: string[]): Args {
  let file = path.join(REPO_ROOT, "data", "magyar-szavak.txt");
  let code = "hu";
  let name = "Magyar";
  let dryRun = false;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--code") code = argv[++i];
    else if (arg === "--name") name = argv[++i];
    else if (arg === "--dry-run") dryRun = true;
    else positional.push(arg);
  }
  if (positional[0]) file = path.resolve(positional[0]);
  return { file, code, name, dryRun };
}

export interface WordRow {
  word: string;
  length: number;
  signature: string;
}

/**
 * Read a wordlist file, returning one normalised, de-duplicated row per accepted word.
 * Shared by the real import and the --dry-run path so the two never drift.
 *
 * The file is read whole rather than streamed: at ~2 MB that costs nothing, and a
 * readline stream cannot be iterated safely while the loop body awaits a database
 * round-trip (readline closes itself at EOF, and the still-queued lines then blow up
 * with ERR_USE_AFTER_CLOSE).
 */
export async function readWords(
  file: string,
  stats: { read: number; skipped: number },
): Promise<WordRow[]> {
  const lines = (await readFile(file, "utf-8")).split(/\r?\n/);
  const seen = new Set<string>();
  const rows: WordRow[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    stats.read++;
    const word = normalizeWord(line);
    if (!word || seen.has(word)) {
      stats.skipped++;
      continue;
    }
    seen.add(word);
    rows.push({ word, length: letterCount(word), signature: signatureOf(word) });
  }
  return rows;
}

async function runDryRun(file: string, code: string): Promise<void> {
  const stats = { read: 0, skipped: 0 };
  let kept = 0;
  const byLength = new Map<number, number>();
  const samples: WordRow[] = [];
  for (const row of await readWords(file, stats)) {
    kept++;
    byLength.set(row.length, (byLength.get(row.length) ?? 0) + 1);
    if (samples.length < 8) samples.push(row);
  }
  console.log(`DRY RUN — no database touched (wordlist '${code}')`);
  console.log(
    `read ${stats.read} lines, skipped ${stats.skipped} (out-of-range/duplicate), kept ${kept}.`,
  );
  console.log("by length:");
  for (const len of [...byLength.keys()].sort((a, b) => a - b)) {
    console.log(`  ${String(len).padStart(2)}: ${byLength.get(len)}`);
  }
  console.log("samples (word -> signature):");
  for (const s of samples) console.log(`  ${s.word} -> ${s.signature}`);
}

async function runImport(file: string, code: string, name: string): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error(
      "ERROR: set DATABASE_URL to the CLOUD Supabase connection string, e.g.\n" +
        "  DATABASE_URL='postgresql://postgres:...@db.<ref>.supabase.co:5432/postgres' npm run db:import\n" +
        "(Use --dry-run to validate parsing without a database.)",
    );
    process.exit(1);
  }

  console.log(`Importing "${file}" into wordlist '${code}' (${name})`);
  // `prepare: false` keeps this working through Supabase's transaction pooler
  // (pgBouncer transaction mode can't hold named prepared statements). Negligible
  // cost for a one-shot bulk import, and robust to whichever connection string is used.
  const sql = postgres(databaseUrl, { onnotice: () => {}, prepare: false });

  try {
    // Upsert the wordlist row and get its id.
    const [wordlist] = await sql<{ id: number }[]>`
      insert into wordlists (code, name)
      values (${code}, ${name})
      on conflict (code) do update set name = excluded.name
      returning id
    `;
    const wordlistId = wordlist.id;

    const stats = { read: 0, skipped: 0 };
    let upserted = 0;
    let batch: { wordlist_id: number; word: string; length: number; signature: string }[] = [];

    const flush = async () => {
      if (batch.length === 0) return;
      await sql`
        insert into words ${sql(batch, "wordlist_id", "word", "length", "signature")}
        on conflict (wordlist_id, word)
        do update set length = excluded.length, signature = excluded.signature
      `;
      upserted += batch.length;
      batch = [];
      process.stdout.write(`\r  upserted ${upserted} words...`);
    };

    for (const row of await readWords(file, stats)) {
      batch.push({ wordlist_id: wordlistId, ...row });
      if (batch.length >= BATCH_SIZE) await flush();
    }
    await flush();
    process.stdout.write("\n");

    const [{ count }] = await sql<{ count: string }[]>`
      select count(*)::text as count from words where wordlist_id = ${wordlistId}
    `;
    console.log(
      `Done. read ${stats.read} lines, skipped ${stats.skipped} (out-of-range/duplicate), ` +
        `upserted ${upserted}. Table now holds ${count} words for '${code}'.`,
    );
  } finally {
    await sql.end();
  }
}

async function main() {
  const { file, code, name, dryRun } = parseArgs(process.argv.slice(2));
  if (dryRun) await runDryRun(file, code);
  else await runImport(file, code, name);
}

/**
 * The direct database host (db.<ref>.supabase.co) publishes an AAAA record only, so on an
 * IPv4-only network the connection silently hangs until it times out. Point the user at the
 * pooler rather than making them dig through a stack trace.
 */
function explain(err: unknown): void {
  const { code, address } = (err ?? {}) as { code?: string; address?: string };
  if (code !== "CONNECT_TIMEOUT" || !address?.startsWith("db.")) return;
  console.error(
    `\nCould not reach ${address} — that is Supabase's *direct* host, which is IPv6-only.\n` +
      "If your network has no public IPv6 route, use the pooler connection string instead\n" +
      "(Supabase dashboard -> Project Settings -> Database -> Connection string -> Transaction\n" +
      "pooler). It looks like:\n\n" +
      "  postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres\n",
  );
}

// Only run when executed directly (so the pure helpers can be imported for tests).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    explain(err);
    process.exit(1);
  });
}
