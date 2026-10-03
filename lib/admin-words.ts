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
  const [row] = await sql<{ x: number }[]>`
    select 1 as x from games
     where target_word = ${word} and wordlist_id = ${wordlistId} and status = 'active'
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
 * live targets (the same rule as deleteWord: the target is a text snapshot, and the row has
 * to exist for it to stay guessable) and reports them back, rather than failing the batch.
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
    const live = await sql<{ word: string; wordlist_id: string }[]>`
      select distinct g.target_word as word, g.wordlist_id
        from games g
        join words w on w.word = g.target_word and w.wordlist_id = g.wordlist_id
       where g.status = 'active' and w.id = any(${found.map((w) => w.id)})
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
