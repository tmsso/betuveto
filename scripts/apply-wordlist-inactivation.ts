/**
 * Switch off (inactivate) a list of words in one wordlist, or switch the last batch back on
 * (ROADMAP 16.9, Step 2). Never deletes: an inactive word is neither a target nor an accepted
 * guess, and setting it active again restores it exactly.
 *
 * Only rows that are `active` and `source = 'original'` are touched (D-16.9c: admin-approved
 * player suggestions and already-inactive rows are left alone). A word that is the target of
 * a game whose clock is still running, or of today's daily puzzle, is skipped and reported
 * (like lib/admin-words.ts isActiveGameTarget, but ignoring abandoned games past `ends_at`).
 * Re-run the script later to catch those; it is idempotent.
 *
 * --apply writes ONE admin_audit_log row (action `wordlist_inactivate`) whose payload holds the
 * list file's sha256 and the exact words it switched off. --revert reactivates exactly the words
 * in the newest such row for this wordlist and file, never "everything in the file", because
 * some of those words may have been inactive before for other reasons (e.g. a player report).
 *
 * Writes need --confirm-host <host>, the database host printed by the dry run, so a command
 * pasted against the wrong DATABASE_URL fails instead of writing.
 *
 * Usage:
 *   node --env-file=.env --import tsx scripts/apply-wordlist-inactivation.ts <list.txt> [--code hu]
 *        (dry run: counts only)
 *   ... <list.txt> --apply  --confirm-host <host>
 *   ... <list.txt> --revert --confirm-host <host>
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { normalizeWord } from "../lib/words.js";

export const BATCH_SIZE = 2000;
export const AUDIT_ACTION = "wordlist_inactivate";

/** Words from a list file: one per line, `#` comments and blank lines ignored, normalised
 *  like the importer. Lines that don't normalise to a game word are counted, not trusted. */
export function parseList(text: string): { words: string[]; invalid: string[] } {
  const seen = new Set<string>();
  const words: string[] = [];
  const invalid: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const raw = line.trim();
    if (!raw || raw.startsWith("#")) continue;
    const word = normalizeWord(raw);
    if (!word) invalid.push(raw);
    else if (!seen.has(word)) {
      seen.add(word);
      words.push(word);
    }
  }
  return { words, invalid };
}

export function batches<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Shared filter: $1 = wordlist id, $2 = text[] of words. Rows eligible for inactivation. */
const ELIGIBLE = `
  w.wordlist_id = $1 and w.word = any($2::text[]) and w.active and w.source = 'original'`;
/** Rows that must not change right now: the target of a game whose clock is still running,
 *  or of today's daily. `status = 'active'` alone is not enough: an abandoned game keeps that
 *  status forever (2,761 such rows on a 2026-11-19 production copy, 62 of them really live), and
 *  the server rejects guesses after `ends_at` anyway. */
const IN_PLAY = `
  (exists (select 1 from games g
            where g.target_word = w.word and g.wordlist_id = w.wordlist_id
              and g.status = 'active' and g.ends_at > now())
   or exists (select 1 from daily_puzzles d
               where d.target_word = w.word and d.wordlist_id = w.wordlist_id
                 and d.puzzle_date = (now() at time zone 'Europe/Budapest')::date))`;

/** Dry-run counts for one batch: eligible words and the in-play ones among them. */
export const DRY_RUN_SQL = `
  select w.word, w.length, ${IN_PLAY} as in_play
    from words w
   where ${ELIGIBLE}`;

/** Inactivates one batch, skipping in-play targets; returns the words it switched off. */
export const INACTIVATE_SQL = `
  update words w set active = false
   where ${ELIGIBLE} and not ${IN_PLAY}
  returning w.word`;

/** $1 = wordlist id, $2 = text[]: reactivates exactly these words if still inactive. */
export const REACTIVATE_SQL = `
  update words w set active = true
   where w.wordlist_id = $1 and w.word = any($2::text[]) and not w.active
  returning w.word`;

/** Active words per length 3-15 in one wordlist (the D-16.9a sanity numbers). */
export const ACTIVE_PER_LENGTH_SQL = `
  select length, count(*)::int as n from words
   where wordlist_id = $1 and active group by length order by length`;

interface Args {
  file: string;
  code: string;
  mode: "dry-run" | "apply" | "revert";
  confirmHost?: string;
}

export function parseArgs(argv: string[]): Args {
  let file = "";
  let code = "hu";
  let mode: Args["mode"] = "dry-run";
  let confirmHost: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--code") code = argv[++i] ?? "";
    else if (a === "--apply") mode = "apply";
    else if (a === "--revert") mode = "revert";
    else if (a === "--dry-run") mode = "dry-run";
    else if (a === "--confirm-host") confirmHost = argv[++i];
    else if (a.startsWith("--")) throw new Error(`Unknown option ${a}`);
    else file = a;
  }
  if (!file) throw new Error("Pass the word list file as the first argument.");
  return { file, code, mode, confirmHost };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const text = await readFile(args.file, "utf-8");
  const sha256 = createHash("sha256").update(text).digest("hex");
  const { words, invalid } = parseList(text);
  const fileName = path.basename(args.file);

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const host = new URL(url).hostname;
  console.log(`database host: ${host}`);
  console.log(`list: ${fileName}, ${words.length} words, sha256 ${sha256.slice(0, 16)}…`);
  if (invalid.length) console.log(`ignored ${invalid.length} lines that are not game words: ${invalid.slice(0, 5).join(", ")}`);
  if (args.mode !== "dry-run" && args.confirmHost !== host) {
    throw new Error(`Refusing to write: pass --confirm-host ${host} (the host above) to confirm the target.`);
  }

  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    const [wl] = await sql<{ id: number }[]>`select id from wordlists where code = ${args.code}`;
    if (!wl) throw new Error(`No wordlist with code ${args.code}.`);
    const perLength = async () =>
      Object.fromEntries((await sql.unsafe<{ length: number; n: number }[]>(ACTIVE_PER_LENGTH_SQL, [wl.id])).map((r) => [r.length, r.n]));
    const before = await perLength();

    if (args.mode === "dry-run") {
      let eligible = 0;
      const inPlay: string[] = [];
      const byLen: Record<number, number> = {};
      for (const batch of batches(words, BATCH_SIZE)) {
        for (const r of await sql.unsafe<{ word: string; length: number; in_play: boolean }[]>(DRY_RUN_SQL, [wl.id, batch])) {
          if (r.in_play) inPlay.push(r.word);
          else {
            eligible++;
            byLen[r.length] = (byLen[r.length] ?? 0) + 1;
          }
        }
      }
      console.log(`would inactivate: ${eligible}; skipped as in-play targets: ${inPlay.length} ${inPlay.slice(0, 10).join(" ")}`);
      console.log(`not found / already inactive / suggested: ${words.length - eligible - inPlay.length}`);
      console.log("len  active-now  would-be-active");
      for (const len of Object.keys(before).map(Number)) {
        console.log(`${String(len).padStart(3)}  ${String(before[len]).padStart(10)}  ${String(before[len] - (byLen[len] ?? 0)).padStart(15)}`);
      }
      return;
    }

    if (args.mode === "apply") {
      const changed = await sql.begin(async (tx) => {
        const done: string[] = [];
        for (const batch of batches(words, BATCH_SIZE)) {
          for (const r of await tx.unsafe<{ word: string }[]>(INACTIVATE_SQL, [wl.id, batch])) done.push(r.word);
        }
        const payload = { code: args.code, file: fileName, sha256, count: done.length, words: done };
        await tx`insert into admin_audit_log (admin_id, action, payload)
                 values (null, ${AUDIT_ACTION}, ${tx.json(payload)})`;
        return done;
      });
      console.log(`inactivated ${changed.length} words; ${words.length - changed.length} were skipped (in play, absent, suggested or already inactive). Re-run later to catch in-play ones.`);
    } else {
      const [last] = await sql<{ id: number; payload: { words: string[] } }[]>`
        select id, payload from admin_audit_log
         where action = ${AUDIT_ACTION} and payload->>'code' = ${args.code} and payload->>'file' = ${fileName}
         order by id desc limit 1`;
      if (!last) throw new Error(`No ${AUDIT_ACTION} audit row for ${fileName}; nothing to revert.`);
      const restored = await sql.begin(async (tx) => {
        const done: string[] = [];
        for (const batch of batches(last.payload.words, BATCH_SIZE)) {
          for (const r of await tx.unsafe<{ word: string }[]>(REACTIVATE_SQL, [wl.id, batch])) done.push(r.word);
        }
        await tx`insert into admin_audit_log (admin_id, action, payload)
                 values (null, ${AUDIT_ACTION + "_revert"}, ${tx.json({ code: args.code, file: fileName, reverts: last.id, count: done.length })})`;
        return done;
      });
      console.log(`reactivated ${restored.length} of the ${last.payload.words.length} words from audit row ${last.id}.`);
    }
    const after = await perLength();
    console.log("len  before  after");
    for (const len of Object.keys(after).map(Number)) console.log(`${String(len).padStart(3)}  ${String(before[len]).padStart(6)}  ${String(after[len]).padStart(5)}`);
  } finally {
    await sql.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}

