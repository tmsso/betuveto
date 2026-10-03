/**
 * Word maintenance (ROADMAP Batch 5.2 item 1, the remaining slice after the review queue):
 * search the wordlist, edit a word's text, delete a word outright. Toggling `active` is
 * already covered by lib/admin-queue.ts's resolve/reactivate endpoints — this file is
 * only for the word row itself.
 */
import type { Sql } from "postgres";
import { type AdminIdentity, logAdminAction, logAdminActions } from "./admin.js";
import { db } from "./db.js";
import type { Reply } from "./game.js";
import { DEFAULT_SUSPICION_PARAMS, type SuspicionParams, suspicionReasons } from "./suspicious-words.js";
import { letterCount, normalizeWord, signatureOf } from "./words.js";

const SEARCH_LIMIT = 50;

interface WordRow {
  id: number;
  word: string;
  wordlist_id: number;
  length: number;
  active: boolean;
  source: string;
  created_at: string;
}

/**
 * With a query, an `ilike '%q%'` scan — 155k rows is small enough that this stays well
 * under Vercel's 10s budget even though a leading wildcard can't use the (wordlist_id,
 * word) index. Without one, the most recently added rows (imports aside, that means
 * recent suggestions) are usually what an admin actually wants to see.
 */
export async function searchWords(wordlistCode: string, query: string): Promise<Reply> {
  const sql = db();
  const trimmed = query.trim().normalize("NFC").toUpperCase();

  const rows = trimmed
    ? await sql<WordRow[]>`
        select w.id, w.word, w.wordlist_id, w.length, w.active, w.source, w.created_at
          from words w
          join wordlists wl on wl.id = w.wordlist_id
         where wl.code = ${wordlistCode} and w.word ilike ${`%${trimmed}%`}
         order by w.word
         limit ${SEARCH_LIMIT}
      `
    : await sql<WordRow[]>`
        select w.id, w.word, w.wordlist_id, w.length, w.active, w.source, w.created_at
          from words w
          join wordlists wl on wl.id = w.wordlist_id
         where wl.code = ${wordlistCode}
         order by w.created_at desc
         limit ${SEARCH_LIMIT}
      `;

  return { status: 200, body: { words: rows } };
}

async function loadWord(sql: Sql, wordId: number): Promise<WordRow | null> {
  const [word] = await sql<WordRow[]>`select id, word, wordlist_id, length, active, source, created_at from words where id = ${wordId}`;
  return word ?? null;
}

/**
 * Blocks touching a word that is *currently* the target of an active game. `games.target_word`
 * is a plain text snapshot, not a foreign key, so renaming or deleting the `words` row would
 * silently strand that game: `lib/game.ts`'s `guess()` looks up `where word = :guessed and
 * wordlist_id = :listId`, and its "stay guessable even if inactive" exception only works
 * because the row still exists under the same text. Scoped by wordlist_id too — Batch 6 can
 * put the same string in two different wordlists.
 */
async function isActiveGameTarget(
  sql: Sql,
  word: string,
  wordlistId: number,
): Promise<boolean> {
  // Also today's daily puzzle (ROADMAP 13.5 follow-up): daily_puzzles.target_word is a text
  // snapshot too, and games for it are started all day long, so deleting it would leave
  // the rest of the day's daily unsolvable.
  const [row] = await sql<{ x: number }[]>`
    select 1 as x from games
     where target_word = ${word} and wordlist_id = ${wordlistId} and status = 'active'
    union all
    select 1 from daily_puzzles
     where target_word = ${word} and wordlist_id = ${wordlistId}
       and puzzle_date = (now() at time zone 'Europe/Budapest')::date
     limit 1
  `;
  return !!row;
}

export async function editWord(admin: AdminIdentity, wordId: number, rawWord: unknown): Promise<Reply> {
  if (typeof rawWord !== "string") {
    return { status: 422, body: { detail: "word must be a string." } };
  }
  const normalized = normalizeWord(rawWord);
  if (!normalized) {
    return { status: 422, body: { detail: "word must be 3-15 letters." } };
  }

  const sql = db();
  const existing = await loadWord(sql, wordId);
  if (!existing) return { status: 404, body: { detail: "Unknown word." } };

  if (await isActiveGameTarget(sql, existing.word, existing.wordlist_id)) {
    return {
      status: 409,
      body: { detail: "This word is the target of an active game — try again once it ends." },
    };
  }

  try {
    await sql`
      update words
         set word = ${normalized}, length = ${letterCount(normalized)}, signature = ${signatureOf(normalized)}
       where id = ${wordId}
    `;
  } catch (error) {
    // unique_violation: (wordlist_id, word) already has this spelling.
    if ((error as { code?: string }).code === "23505") {
      return { status: 409, body: { detail: "That spelling already exists in this wordlist." } };
    }
    throw error;
  }

  await logAdminAction(admin, "edit_word", { word_id: wordId, from: existing.word, to: normalized });
  return { status: 200, body: { id: wordId, word: normalized } };
}

export async function deleteWord(admin: AdminIdentity, wordId: number): Promise<Reply> {
  const sql = db();
  const existing = await loadWord(sql, wordId);
  if (!existing) return { status: 404, body: { detail: "Unknown word." } };

  if (await isActiveGameTarget(sql, existing.word, existing.wordlist_id)) {
    return {
      status: 409,
      body: { detail: "This word is the target of an active game — try again once it ends." },
    };
  }

  // Cascades word_reports/word_suggestions rows for this word (both declared ON DELETE
  // CASCADE) — nothing else references words.id, so this is a clean hard delete.
  await sql`delete from words where id = ${wordId}`;

  await logAdminAction(admin, "delete_word", { word_id: wordId, word: existing.word });
  return { status: 200, body: { id: wordId, deleted: true } };
}

export const BULK_ACTIONS = ["inactivate", "reactivate", "delete"] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];
export const BULK_MAX_IDS = 500;

/**
 * ROADMAP 13.5 — one action for many words. Inactivate and reactivate apply to every
 * selected word: a live game's target stays guessable while inactive (`guess()` matches
 * `active or word = target_word`), so inactivating it never strands a game. Delete skips
 * live targets, i.e. running games' and today's daily puzzle's (the same rule as deleteWord:
 * the target is a text snapshot, and the row has to exist for it to stay guessable), and
 * reports them back as active_target rather than failing the batch.
 * One audit row per changed word, like the single-word routes.
 */
export async function bulkWordAction(admin: AdminIdentity, rawAction: unknown, rawIds: unknown): Promise<Reply> {
  if (typeof rawAction !== "string" || !(BULK_ACTIONS as readonly string[]).includes(rawAction)) {
    return { status: 422, body: { detail: `action must be one of ${BULK_ACTIONS.join(", ")}.` } };
  }
  const action = rawAction as BulkAction;
  // words.id is a bigint, which postgres.js hands back as a *string* ("27"). That is what
  // searchWords returns and the admin UI selects, so numeric strings are accepted
  // alongside numbers, and everything is compared as numbers from here on.
  const parsed = Array.isArray(rawIds)
    ? rawIds.map((id) => (typeof id === "string" && /^\d+$/.test(id) ? Number(id) : id))
    : [];
  if (
    parsed.length === 0 || parsed.length > BULK_MAX_IDS ||
    !parsed.every((id) => Number.isSafeInteger(id) && (id as number) > 0)
  ) {
    return { status: 422, body: { detail: `ids must be 1-${BULK_MAX_IDS} positive integers.` } };
  }
  const ids = [...new Set(parsed as number[])];

  const sql = db();
  const found = (await sql<{ id: string; word: string; wordlist_id: string }[]>`
    select id, word, wordlist_id from words where id = any(${ids})
  `).map((w) => ({ id: Number(w.id), word: w.word, wordlist_id: Number(w.wordlist_id) }));
  const foundIds = new Set(found.map((w) => w.id));
  const skipped: { id: number; word?: string; reason: "not_found" | "active_target" }[] = ids
    .filter((id) => !foundIds.has(id))
    .map((id) => ({ id, reason: "not_found" as const }));

  let targets = found;
  if (action === "delete" && found.length > 0) {
    // One query for every candidate, not one isActiveGameTarget call per word.
    // Running games' targets plus today's daily puzzle targets (same reason as
    // isActiveGameTarget above).
    const live = await sql<{ word: string; wordlist_id: string }[]>`
      select g.target_word as word, g.wordlist_id
        from games g
        join words w on w.word = g.target_word and w.wordlist_id = g.wordlist_id
       where g.status = 'active' and w.id = any(${found.map((w) => w.id)})
      union
      select d.target_word, d.wordlist_id
        from daily_puzzles d
        join words w on w.word = d.target_word and w.wordlist_id = d.wordlist_id
       where d.puzzle_date = (now() at time zone 'Europe/Budapest')::date
         and w.id = any(${found.map((w) => w.id)})
    `;
    const liveKeys = new Set(live.map((l) => `${Number(l.wordlist_id)}:${l.word}`));
    targets = found.filter((w) => !liveKeys.has(`${w.wordlist_id}:${w.word}`));
    for (const w of found) {
      if (liveKeys.has(`${w.wordlist_id}:${w.word}`)) skipped.push({ id: w.id, word: w.word, reason: "active_target" });
    }
  }

  const targetIds = targets.map((w) => w.id);
  let changed: { id: number; word: string }[] = [];
  if (targetIds.length > 0) {
    if (action === "delete") {
      // Cascades word_reports/word_suggestions, exactly as deleteWord does.
      changed = (await sql<{ id: string; word: string }[]>`delete from words where id = any(${targetIds}) returning id, word`)
        .map((w) => ({ id: Number(w.id), word: w.word }));
    } else {
      const active = action === "reactivate";
      // Only rows whose state actually changes, so the audit log doesn't fill with no-ops.
      changed = (await sql<{ id: string; word: string }[]>`
        update words set active = ${active} where id = any(${targetIds}) and active <> ${active} returning id, word
      `).map((w) => ({ id: Number(w.id), word: w.word }));
    }
  }

  const auditAction = { inactivate: "inactivate_word", reactivate: "reactivate_word", delete: "delete_word" }[action];
  await logAdminActions(admin, changed.map((w) => ({ action: auditAction, payload: { word_id: w.id, word: w.word, bulk: true } })));

  changed.sort((a, b) => a.id - b.id);
  return { status: 200, body: { action, changed, unchanged_count: targetIds.length - changed.length, skipped } };
}

const SUSPICIOUS_LIMIT = 200;

/**
 * ROADMAP 13.6 — scans a wordlist's *active* words for the heuristics in
 * lib/suspicious-words.ts. A regex pre-filter in Postgres keeps the transfer small: each
 * pattern is a superset of its heuristic (a raw letter run is at least as long as the
 * digraph-aware one), so only candidates leave the database and the exact check runs here.
 * Returns at most SUSPICIOUS_LIMIT words (the admin bulk-acts on a page, then re-scans).
 */
export async function findSuspiciousWords(wordlistCode: string, params: SuspicionParams): Promise<Reply> {
  const sql = db();
  const [list] = await sql<{ id: number; alphabet: string }[]>`
    select id, alphabet from wordlists where code = ${wordlistCode}
  `;
  if (!list) return { status: 404, body: { detail: "Unknown wordlist." } };

  const vowels = wordlistCode === "hu" ? "AÁEÉIÍOÓÖŐUÚÜŰ" : "AEIOUY";
  const foreignPattern = wordlistCode === "hu"
    ? `[^${list.alphabet}]|[QWX]|(^|[^GLNT])Y`
    : `[^${list.alphabet}]`;
  const candidates = await sql<WordRow[]>`
    select id, word, wordlist_id, length, active, source, created_at
      from words
     where wordlist_id = ${list.id} and active
       and (
         length < ${params.minLength}
         or word !~ ${`[${vowels}]`}
         or word !~ ${`[^${vowels}]`}
         or word ~ ${foreignPattern}
         or word ~ ${`[${vowels}]{${params.maxVowelRun + 1},}`}
         or word ~ ${`[^${vowels}]{${params.maxConsonantRun + 1},}`}
       )
     order by word
  `;

  const flagged = candidates
    .map((w) => ({ ...w, reasons: suspicionReasons(w.word, wordlistCode, list.alphabet, params) }))
    .filter((w) => w.reasons.length > 0);
  // Per-reason totals across ALL flagged words (not just the returned page), so the admin
  // can see which rule is producing the noise before tuning a threshold.
  const reasonCounts: Record<string, number> = {};
  for (const w of flagged) for (const r of w.reasons) reasonCounts[r] = (reasonCounts[r] ?? 0) + 1;
  return {
    status: 200,
    body: { words: flagged.slice(0, SUSPICIOUS_LIMIT), total_flagged: flagged.length, reason_counts: reasonCounts, params },
  };
}

/** Query-string thresholds with the defaults, clamped to sane ranges. */
export function suspicionParamsFrom(raw: { minLength?: number; maxVowelRun?: number; maxConsonantRun?: number }): SuspicionParams {
  const clamp = (v: number | undefined, lo: number, hi: number, fallback: number) =>
    v === undefined || !Number.isInteger(v) ? fallback : Math.min(hi, Math.max(lo, v));
  return {
    minLength: clamp(raw.minLength, 1, 15, DEFAULT_SUSPICION_PARAMS.minLength),
    maxVowelRun: clamp(raw.maxVowelRun, 1, 10, DEFAULT_SUSPICION_PARAMS.maxVowelRun),
    maxConsonantRun: clamp(raw.maxConsonantRun, 1, 10, DEFAULT_SUSPICION_PARAMS.maxConsonantRun),
  };
}
