/**
 * Load corpus word frequencies into `words.zipf` (ROADMAP 11.21, migrations/0026).
 *
 * Reads data/frequency-<code>.tsv (`word<TAB>zipf`, produced by scripts/build-frequency.py)
 * and writes each Zipf value onto the matching row of that wordlist. Idempotent and exact:
 * the whole wordlist's column is reset first, inside the same transaction, so a re-run leaves
 * `zipf` equal to the file and nothing stale. Curation (`active`, `source`) is untouched.
 *
 * Usage (pooled Neon connection string; migration 0026 must be applied first):
 *
 *   DATABASE_URL='...' npm run db:frequency -- --code hu
 *   DATABASE_URL='...' npm run db:frequency -- --code en
 *   npm run db:frequency -- --code hu --dry-run     # parse only, no database
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import postgres from "postgres";
import { normalizeWord } from "../lib/words.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BATCH_SIZE = 5000;

export interface FrequencyRow {
  word: string;
  zipf: number;
}

/** Parses the TSV into normalised, de-duplicated rows; malformed or non-positive lines are
 *  counted in `skipped` rather than silently trusted. */
export function parseFrequencyTsv(text: string): { rows: FrequencyRow[]; skipped: number } {
  const seen = new Set<string>();
  const rows: FrequencyRow[] = [];
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [rawWord, rawZipf] = line.split("\t");
    const zipf = Number(rawZipf);
    const word = rawWord ? normalizeWord(rawWord) : null;
    if (!word || !Number.isFinite(zipf) || zipf <= 0 || seen.has(word)) {
      skipped++;
      continue;
    }
    seen.add(word);
    rows.push({ word, zipf });
  }
  return { rows, skipped };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let code = "hu";
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--code") code = argv[++i];
    else if (argv[i] === "--dry-run") dryRun = true;
  }
  const file = path.join(REPO_ROOT, "data", `frequency-${code}.tsv`);
  const { rows, skipped } = parseFrequencyTsv(await readFile(file, "utf-8"));
  console.log(`${path.basename(file)}: ${rows.length} rows, ${skipped} skipped.`);
  if (dryRun) return;

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    const [list] = await sql<{ id: number }[]>`select id from wordlists where code = ${code}`;
    if (!list) throw new Error(`No wordlist with code '${code}'. Import it first (npm run db:import).`);

    const matched = await sql.begin(async (tx) => {
      await tx`update words set zipf = null where wordlist_id = ${list.id} and zipf is not null`;
      let count = 0;
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const updated = await tx`
          update words w set zipf = v.zipf
            from unnest(${batch.map((r) => r.word)}::text[], ${batch.map((r) => r.zipf)}::real[])
                 as v(word, zipf)
           where w.wordlist_id = ${list.id} and w.word = v.word
        `;
        count += updated.count;
      }
      return count;
    });
    console.log(`'${code}': ${matched} words ranked (${rows.length - matched} file rows have no matching word).`);
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
