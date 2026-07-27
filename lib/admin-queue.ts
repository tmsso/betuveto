/**
 * Word review queue (ROADMAP Batch 5.1/5.2 item 1): read-only for now — open reports and
 * suggestions, grouped per word. Approve/reject/reactivate/edit/delete/search are a later
 * PR; this is the smallest slice that makes the admin shell show real data.
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
