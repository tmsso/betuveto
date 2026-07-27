/**
 * Word review queue (ROADMAP Batch 5.1/5.2 item 1): listing, plus accept/reject/
 * reactivate mutations. Edit/delete words and search-the-wordlist are still a later PR.
 */
import { db } from "./db.js";
import type { Reply } from "./game.js";

interface ReportRow {
  word_id: number;
  word: string;
  wordlist: string;
  active: boolean;
  report_count: number;
  reasons: (string | null)[];
  first_reported_at: string;
}

interface SuggestionRow {
  id: number;
  word: string;
  wordlist: string;
  created_at: string;
  suggested_by: string | null;
}

export async function getReviewQueue(): Promise<Reply> {
  const sql = db();

  // One row per word: word_reports has one row per (word, player) pair, so distinct
  // reporters accrue as extra rows here rather than extra words — grouping mirrors the
  // same count(distinct player_id) the auto-inactivation check in lib/word-reports.ts uses.
  const reports = await sql<ReportRow[]>`
    select w.id as word_id, w.word, wl.code as wordlist, w.active,
           count(*)::int as report_count,
           array_agg(wr.reason) filter (where wr.reason is not null) as reasons,
           min(wr.created_at) as first_reported_at
      from word_reports wr
      join words w on w.id = wr.word_id
      join wordlists wl on wl.id = w.wordlist_id
     where wr.status = 'open'
     group by w.id, w.word, wl.code, w.active
     order by first_reported_at asc
  `;

  // Each suggested word gets at most one open row in practice: lib/word-suggestions.ts's
  // suggestWord() short-circuits to already_present before inserting a second one for the
  // same word, so no grouping is needed here the way reports needs it above.
  const suggestions = await sql<SuggestionRow[]>`
    select ws.id, w.word, wl.code as wordlist, ws.created_at, p.display_name as suggested_by
      from word_suggestions ws
      join words w on w.id = ws.word_id
      join wordlists wl on wl.id = w.wordlist_id
      left join players p on p.id = ws.player_id
     where ws.status = 'open'
     order by ws.created_at asc
  `;

  return { status: 200, body: { reports, suggestions } };
}

/** One row per admin mutation, admin_id left null — see the 0004 migration's comment for
 *  why: the interim token auth (5.1) has no per-admin identity to attribute this to yet. */
async function logAdminAction(action: string, payload: Record<string, string | number>): Promise<void> {
  const sql = db();
  await sql`
    insert into admin_audit_log (action, payload) values (${action}, ${sql.json(payload)})
  `;
}

/**
 * Accept: the report was right — the word IS wrong. Deactivates it (idempotent if
 * auto-inactivation already had) and closes every open report for it.
 * Reject: the report was wrong — the word is fine. Reactivates it and closes the reports.
 * Both branches touch `words` and `word_reports` together, so they run in one transaction.
 */
export async function resolveReport(wordId: number, decision: "accept" | "reject"): Promise<Reply> {
  const sql = db();

  const [word] = await sql<{ id: number; word: string }[]>`
    select id, word from words where id = ${wordId}
  `;
  if (!word) return { status: 404, body: { detail: "Unknown word." } };

  const shouldBeActive = decision === "reject";
  const reportStatus = decision === "accept" ? "accepted" : "rejected";

  const updated = await sql.begin(async (tx) => {
    await tx`update words set active = ${shouldBeActive} where id = ${wordId}`;
    return tx<{ id: number }[]>`
      update word_reports set status = ${reportStatus}
       where word_id = ${wordId} and status = 'open'
      returning id
    `;
  });
  if (updated.length === 0) {
    return { status: 404, body: { detail: "No open reports for this word." } };
  }

  await logAdminAction("resolve_report", { word_id: wordId, word: word.word, decision });
  return { status: 200, body: { word: word.word, active: shouldBeActive, resolved_count: updated.length } };
}

/** Reactivates a word directly, independent of any report's status — an admin override
 *  for the auto-inactivation rule (ROADMAP 4.1), not tied to resolving a specific report. */
export async function reactivateWord(wordId: number): Promise<Reply> {
  const sql = db();
  const [word] = await sql<{ id: number; word: string }[]>`
    update words set active = true where id = ${wordId} returning id, word
  `;
  if (!word) return { status: 404, body: { detail: "Unknown word." } };

  await logAdminAction("reactivate_word", { word_id: wordId, word: word.word });
  return { status: 200, body: { word: word.word, active: true } };
}

/**
 * Approve: the word is real — activates it and marks the suggestion accepted.
 * Reject: leaves the word row inactive (harmless dead weight; deleting it is the
 * deferred "delete words" feature) and marks the suggestion rejected.
 */
export async function resolveSuggestion(
  suggestionId: number,
  decision: "approve" | "reject",
): Promise<Reply> {
  const sql = db();

  const [suggestion] = await sql<{ id: number; word_id: number; word: string; status: string }[]>`
    select ws.id, ws.word_id, w.word, ws.status
      from word_suggestions ws
      join words w on w.id = ws.word_id
     where ws.id = ${suggestionId}
  `;
  if (!suggestion) return { status: 404, body: { detail: "Unknown suggestion." } };
  if (suggestion.status !== "open") {
    return { status: 409, body: { detail: `Suggestion already ${suggestion.status}.` } };
  }

  const newStatus = decision === "approve" ? "accepted" : "rejected";
  await sql.begin(async (tx) => {
    if (decision === "approve") {
      await tx`update words set active = true where id = ${suggestion.word_id}`;
    }
    await tx`update word_suggestions set status = ${newStatus} where id = ${suggestionId}`;
  });

  await logAdminAction("resolve_suggestion", {
    suggestion_id: suggestionId,
    word: suggestion.word,
    decision,
  });
  return { status: 200, body: { word: suggestion.word, decision } };
}
