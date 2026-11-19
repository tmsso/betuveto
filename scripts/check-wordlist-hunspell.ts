/**
 * Check the Hungarian wordlist against Magyar Ispell (ROADMAP 16.9, Step 1). Local only: no
 * database. Writes data/wordlist-review/hu-not-in-ispell.tsv (`word<TAB>length<TAB>zipf`) and
 * prints the counts that Gate A (D-16.9a-d) is decided on.
 *
 * Words are normalised exactly as scripts/import-wordlist.ts does (`normalizeWord`), so every
 * output word is spelled the way its `words` row is (uppercase NFC). Each word is checked
 * in *lowercase*: the importer uppercases everything, so "Dabas" (a town) and "dabas" are
 * the same game word, and hunspell accepts a lowercase word only as a common noun etc. A
 * proper noun therefore counts as rejected, which is what a word game wants.
 *
 * Requires: `sudo apt install hunspell hunspell-hu` (Debian's hunspell-hu is Magyar Ispell).
 *
 * A fourth column, `split`, shows the first way to cut a rejected word into two parts that
 * hunspell accepts on their own (each >= 3 letters), e.g. `kéz+írat`. Hunspell's compounding
 * rules miss many real compounds, so this is the main false-positive signal for Gate A.
 *
 * Usage: npx tsx scripts/check-wordlist-hunspell.ts [--sample 30]
 */
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { letterCount, normalizeWord } from "../lib/words.js";
import { parseFrequencyTsv } from "./import-frequency.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORDLIST = path.join(REPO_ROOT, "data/magyar-szavak.txt");
const FREQUENCY = path.join(REPO_ROOT, "data/frequency-hu.tsv");
const OUT_DIR = path.join(REPO_ROOT, "data/wordlist-review");
const OUT_FILE = path.join(OUT_DIR, "hu-not-in-ispell.tsv");
/** Shortest part a compound split may have: shorter cuts match noise ("ab", "ka"). */
export const MIN_SPLIT_PART = 3;
/** Zipf 3 = about once per million words of real text: D-16.9b's "frequency rescue" line. */
export const RESCUE_ZIPF = 3;

export interface ReviewRow {
  word: string;
  length: number;
  zipf: number | null;
  /** First two-part split hunspell accepts, as "elő+rész" (check forms), or null. */
  split: string | null;
}

/** Normalised, de-duplicated game words in file order (same rules as the importer). */
export function gameWords(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const word = normalizeWord(line);
    if (word && !seen.has(word)) {
      seen.add(word);
      out.push(word);
    }
  }
  return out;
}

/** The form hunspell is asked about (see the header: lowercase on purpose). */
export function checkForm(word: string): string {
  return word.toLocaleLowerCase("hu");
}

/** The rejected words as review rows, in input order. `rejected` holds check forms. */
export function reviewRows(
  words: string[],
  rejected: Set<string>,
  frequency: Map<string, number>,
  partAccepted: (part: string) => boolean = () => false,
): ReviewRow[] {
  return words
    .filter((w) => rejected.has(checkForm(w)))
    .map((w) => ({
      word: w,
      length: letterCount(w),
      zipf: frequency.get(w) ?? null,
      split: firstSplit(checkForm(w), partAccepted),
    }));
}

/** Every cut of `form` into two parts of at least MIN_SPLIT_PART letters, left to right. */
export function splitsOf(form: string): [string, string][] {
  const letters = Array.from(form); // code points, so "ő" counts as one letter
  const out: [string, string][] = [];
  for (let i = MIN_SPLIT_PART; i <= letters.length - MIN_SPLIT_PART; i++) {
    out.push([letters.slice(0, i).join(""), letters.slice(i).join("")]);
  }
  return out;
}

export function firstSplit(form: string, partAccepted: (part: string) => boolean): string | null {
  const hit = splitsOf(form).find(([a, b]) => partAccepted(a) && partAccepted(b));
  return hit ? `${hit[0]}+${hit[1]}` : null;
}

export function toTsv(rows: ReviewRow[]): string {
  const lines = rows.map((r) => `${r.word}\t${r.length}\t${r.zipf ?? ""}\t${r.split ?? ""}`);
  return ["word\tlength\tzipf\tsplit", ...lines].join("\n") + "\n";
}

/** Runs `hunspell -l`, which echoes back only the words the dictionary does NOT accept. */
function hunspellReject(forms: string[]): Promise<Set<string>> {
  return new Promise((resolve, reject) => {
    const child = spawn("hunspell", ["-d", "hu_HU", "-i", "utf-8", "-l"]);
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf-8").on("data", (d) => (out += d));
    child.stderr.setEncoding("utf-8").on("data", (d) => (err += d));
    child.on("error", reject); // e.g. hunspell not installed
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`hunspell exited ${code}: ${err.trim()}`));
      resolve(new Set(out.split("\n").filter(Boolean)));
    });
    child.stdin.end(forms.join("\n") + "\n");
  });
}

function sample<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  const step = items.length / n; // evenly spread, deterministic (the list is alphabetical)
  return Array.from({ length: n }, (_, i) => items[Math.floor(i * step)]);
}

async function main(): Promise<void> {
  const sampleIdx = process.argv.indexOf("--sample");
  const sampleSize = sampleIdx > 0 ? Number(process.argv[sampleIdx + 1]) : 30;

  const words = gameWords(await readFile(WORDLIST, "utf-8"));
  const frequency = new Map(
    parseFrequencyTsv(await readFile(FREQUENCY, "utf-8")).rows.map((r) => [r.word, r.zipf] as const),
  );
  const forms = Array.from(new Set(words.map(checkForm)));
  const rejected = await hunspellReject(forms);
  // Sanity: hunspell must accept an obvious word, or the dictionary isn't loaded.
  if ((await hunspellReject(["almafa"])).size !== 0) throw new Error("hu_HU dictionary not working");

  // One more hunspell pass over every candidate part of every rejected word.
  const parts = new Set<string>();
  for (const w of words) {
    if (rejected.has(checkForm(w))) for (const pair of splitsOf(checkForm(w))) pair.forEach((p) => parts.add(p));
  }
  const badParts = await hunspellReject(Array.from(parts));
  const rows = reviewRows(words, rejected, frequency, (p) => !badParts.has(p));
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_FILE, toTsv(rows));

  const byLen = (list: { length: number }[], len: number) => list.filter((r) => r.length === len).length;
  const all = words.map((w) => ({ length: letterCount(w) }));
  const rescued = rows.filter((r) => r.zipf !== null && r.zipf >= RESCUE_ZIPF);
  const split = rows.filter((r) => r.split !== null);
  const foreign = rows.filter((r) => /[QWXY]/.test(r.word));
  console.log(`game words: ${words.length}; rejected by hunspell: ${rows.length}`);
  console.log(`  with zipf >= ${RESCUE_ZIPF} (frequency rescue): ${rescued.length}`);
  console.log(`  with a two-part split (compound rescue): ${split.length}`);
  console.log(`  containing Q/W/X/Y: ${foreign.length}`);
  console.log("len   total  rejected  zipf>=3  split  active-after(no rescue)  (split rescue)");
  for (let len = 3; len <= 15; len++) {
    const total = byLen(all, len);
    const rej = byLen(rows, len);
    const cells = [len, total, rej, byLen(rescued, len), byLen(split, len), total - rej, total - rej + byLen(split, len)];
    console.log(cells.map((v) => String(v).padStart(7)).join(" "));
  }
  const accepted = words.filter((w) => !rejected.has(checkForm(w)));
  console.log(`\nsample rejected (${sampleSize}):`);
  console.log(sample(rows, sampleSize).map((r) => `${r.word}(${r.zipf ?? "-"})`).join(" "));
  console.log(`\nsample accepted (${sampleSize}):`);
  console.log(sample(accepted, sampleSize).join(" "));
  console.log(`\nrescued sample (${sampleSize}):`);
  console.log(sample(rescued, sampleSize).map((r) => `${r.word}(${r.zipf})`).join(" "));
  console.log(`\nsplit sample (${sampleSize}):`);
  console.log(sample(split, sampleSize).map((r) => r.split).join(" "));
  console.log(`\nwrote ${path.relative(REPO_ROOT, OUT_FILE)}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
