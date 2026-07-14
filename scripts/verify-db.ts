/**
 * Verify a Batch 1.1 deployment against the CLOUD Supabase project: schema applied,
 * wordlist imported, RLS locked down, and — most importantly — that the signature-subset
 * query the API will rely on (ROADMAP decision 6) returns the right words and uses the
 * index rather than scanning 155k rows.
 *
 *   DATABASE_URL='postgresql://postgres.<ref>:...@aws-0-<region>.pooler.supabase.com:6543/postgres' \
 *     npm run db:verify
 *
 * Read-only: this script never writes.
 */
import postgres from "postgres";
import { normalizeWord, signatureOf } from "./import-wordlist.ts";

const TABLES = ["players", "wordlists", "words", "games", "game_guesses", "word_stats"];
const EXPECTED_WORDS = 155107;
const BOARD = "HANGKÖZ"; // a 7-letter target with no repeated letters

/** Every distinct sub-multiset of the board's letters, as sorted signatures. */
export function subSignatures(board: string, minLength: number): string[] {
  const letters = Array.from(board).sort();
  const out = new Set<string>();
  const walk = (i: number, picked: string[]) => {
    if (i === letters.length) {
      if (picked.length >= minLength) out.add(picked.join(""));
      return;
    }
    walk(i + 1, [...picked, letters[i]]);
    walk(i + 1, picked);
  };
  walk(0, []);
  return [...out];
}

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`);
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("ERROR: set DATABASE_URL to the CLOUD Supabase pooler connection string.");
    process.exit(1);
  }
  const sql = postgres(databaseUrl, { onnotice: () => {}, prepare: false });

  try {
    console.log("Schema");
    const tables = await sql<{ tablename: string }[]>`
      select tablename from pg_tables where schemaname = 'public'
    `;
    const present = new Set(tables.map((t) => t.tablename));
    for (const t of TABLES) check(`table ${t} exists`, present.has(t), true);

    console.log("\nRow-level security (must be enabled on every table — ROADMAP 1.1)");
    const rls = await sql<{ relname: string; relrowsecurity: boolean }[]>`
      select relname, relrowsecurity from pg_class
       where relnamespace = 'public'::regnamespace and relname = any(${TABLES})
    `;
    for (const row of rls) check(`RLS on ${row.relname}`, row.relrowsecurity, true);

    console.log("\nWordlist");
    const [list] = await sql<{ id: number; code: string; name: string }[]>`
      select id, code, name from wordlists where code = 'hu'
    `;
    check("wordlist 'hu' present", list?.code, "hu");
    const [{ total }] = await sql<{ total: string }[]>`
      select count(*)::text as total from words where wordlist_id = ${list.id}
    `;
    check("total words", total, EXPECTED_WORDS);
    const [{ bad }] = await sql<{ bad: string }[]>`
      select count(*)::text as bad from words
       where wordlist_id = ${list.id}
         and (length <> char_length(word) or signature is null or length < 3 or length > 15)
    `;
    check("rows with a bad length/signature", bad, 0);

    console.log(`\nSignature-subset query (board '${BOARD}' — the Batch 1.2 hot path)`);
    const board = normalizeWord(BOARD)!;
    const signatures = subSignatures(signatureOf(board), 3);
    console.log(`  board signature ${signatureOf(board)} -> ${signatures.length} sub-signatures`);

    const started = Date.now();
    const found = await sql<{ word: string }[]>`
      select word from words
       where wordlist_id = ${list.id} and active and signature = any(${signatures})
       order by word
    `;
    const elapsed = Date.now() - started;
    console.log(`  ${found.length} findable words in ${elapsed} ms`);

    // Cross-check against the brute-force definition the Python backend uses: a word is
    // playable iff every letter fits in the board's letter budget.
    const budget = new Map<string, number>();
    for (const ch of board) budget.set(ch, (budget.get(ch) ?? 0) + 1);
    const canForm = (word: string): boolean => {
      const left = new Map(budget);
      for (const ch of word) {
        const n = left.get(ch) ?? 0;
        if (n === 0) return false;
        left.set(ch, n - 1);
      }
      return true;
    };
    const all = await sql<{ word: string }[]>`
      select word from words where wordlist_id = ${list.id} and active order by word
    `;
    const brute = all.map((r) => r.word).filter(canForm);
    check("signature-subset count == brute-force count", found.length, brute.length);
    check(
      "same words",
      found.map((r) => r.word).join(",") === brute.join(","),
      true,
    );

    console.log("\nQuery plan (must use the index, not a seq scan on 155k rows)");
    const plan = await sql<{ "QUERY PLAN": string }[]>`
      explain select word from words
       where wordlist_id = ${list.id} and active and signature = any(${signatures})
    `;
    const planText = plan.map((r) => r["QUERY PLAN"]).join("\n");
    console.log(planText.split("\n").map((l) => `    ${l}`).join("\n"));
    check("index scan used", /Index|Bitmap/.test(planText) && !/Seq Scan/.test(planText), true);

    console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
    process.exitCode = failures === 0 ? 0 : 1;
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
