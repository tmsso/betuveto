/**
 * Word maintenance (ROADMAP Batch 5.2 item 1, the remaining slice after the review queue):
 * search the wordlist, edit a word's text, delete a word outright. Toggling `active` is
 * already covered by lib/admin-queue.ts's resolve/reactivate endpoints — this file is
 * only for the word row itself.
 */
import type { Sql } from "postgres";
import { logAdminAction } from "./admin.js";
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

export async function editWord(wordId: number, rawWord: unknown): Promise<Reply> {
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

  await logAdminAction("edit_word", { word_id: wordId, from: existing.word, to: normalized });
  return { status: 200, body: { id: wordId, word: normalized } };
}

export async function deleteWord(wordId: number): Promise<Reply> {
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

  await logAdminAction("delete_word", { word_id: wordId, word: existing.word });
  return { status: 200, body: { id: wordId, deleted: true } };
}
