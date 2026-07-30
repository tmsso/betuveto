/**
 * Verify a Batch 1 deployment against the Neon database: schema applied, wordlist
 * imported, and — most importantly — that the signature-subset query the API will rely on
 * (ROADMAP decision 6) returns the right words and uses the index rather than scanning
 * 155k rows.
 *
 *   DATABASE_URL='<neon pooled connection string>' npm run db:verify
 *
 * Read-only: this script never writes.
 */
import postgres from "postgres";
import { MIN_WORD_LENGTH, canFormWord, normalizeWord, signatureOf, subSignatures } from "../lib/words.js";

const TABLES = ["players", "wordlists", "words", "games", "game_guesses", "word_stats"];
// The count as originally imported (Batch 1.1/1.5) — a floor, not an exact match. An
// approved word suggestion (ROADMAP 4.2/5.2) permanently activates a word outside the
// imported file, so a deployment this has ever approved a suggestion against legitimately
// holds more active words than this. Same relaxation the contract suite's own
// "reports the imported dictionary" test already made; this script's exact check was
// pre-existing and just hadn't been updated to match (caught live in production while
// verifying Batch 6.1, unrelated to that batch's own change).
// Lowered from 155107 by migrations/0011 (ROADMAP 1.1 bugfix) purging 2,882 non-alpha
// rows that were never legitimately part of this count in the first place.
const MIN_EXPECTED_HU_WORDS = 152228;
// English wordlist (ROADMAP 6.1) floor: this script previously only asserted anything
// about 'hu', so a deployment where the 'en' import silently failed or was never run
// would still print ALL CHECKS PASSED — caught during the 6.2 follow-up review, not by
// this script itself.
const MIN_EXPECTED_EN_WORDS = 269746;
const BOARD = "HANGKÖZ"; // a 7-letter target with no repeated letters

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${actual}${ok ? "" : ` (expected ${expected})`}`);
}

function checkAtLeast(label: string, actual: number, min: number): void {
  const ok = actual >= min;
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${actual}${ok ? "" : ` (expected >= ${min})`}`);
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("ERROR: set DATABASE_URL to the Neon pooled connection string.");
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

    console.log("\nWord content (ROADMAP 1.1 bugfix — normalizeWord() now rejects these on import)");
    const [{ nonAlpha }] = await sql<{ nonAlpha: string }[]>`
      select count(*)::text as "nonAlpha" from words where word ~ '[^[:alpha:]]'
    `;
    check("words with a non-letter character (hyphens, spaces, punctuation)", nonAlpha, 0);

    console.log("\nWordlist");
    const [list] = await sql<{ id: number; code: string; name: string }[]>`
      select id, code, name from wordlists where code = 'hu'
    `;
    check("wordlist 'hu' present", list?.code, "hu");
    const [{ total }] = await sql<{ total: number }[]>`
      select count(*)::int as total from words where wordlist_id = ${list.id}
    `;
    checkAtLeast("total words", total, MIN_EXPECTED_HU_WORDS);
    const [{ bad }] = await sql<{ bad: string }[]>`
      select count(*)::text as bad from words
       where wordlist_id = ${list.id}
         and (length <> char_length(word) or signature is null or length < 3 or length > 15)
    `;
    check("rows with a bad length/signature", bad, 0);

    console.log("\nWordlist 'en' (ROADMAP 6.1)");
    const [enList] = await sql<{ id: number; code: string }[]>`
      select id, code from wordlists where code = 'en'
    `;
    check("wordlist 'en' present", enList?.code, "en");
    if (enList) {
      const [{ total: enTotal }] = await sql<{ total: number }[]>`
        select count(*)::int as total from words where wordlist_id = ${enList.id}
      `;
      checkAtLeast("total words", enTotal, MIN_EXPECTED_EN_WORDS);
    }

    console.log(`\nSignature-subset query (board '${BOARD}' — the Batch 1.2 hot path)`);
    const board = normalizeWord(BOARD)!;
    const signatures = subSignatures(signatureOf(board), MIN_WORD_LENGTH);
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
    const all = await sql<{ word: string }[]>`
      select word from words where wordlist_id = ${list.id} and active order by word
    `;
    const brute = all.map((r) => r.word).filter((word) => canFormWord(word, board));
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
