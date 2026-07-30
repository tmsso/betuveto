/**
 * Per-player word history (ROADMAP Batch 3.3), used purely server-side to steer target
 * selection — never displayed to players (product decision 2026-07-30: this isn't an
 * educational/practice game, so no per-word failure/solve history is shown or served to
 * the client; only aggregate stats and the picker functions below consume this table).
 * `lib/game.ts` writes to this on every game-ending transition.
 *
 * Keyed per (player, wordlist, word) since migrations/0009 (ROADMAP 6.1) — a spelling
 * common to two languages must not merge its failed/solved counts across them.
 */
import type { Sql } from "postgres";
import { db } from "./db.js";
import type { Reply } from "./game.js";

// How long a personally-mastered word stays excluded from this player's own target draws
// (see recordSolved/pickPersonalizedWord below) — "ideally shouldn't come up again for
// ~100 turns" per the product decision above.
const MASTERY_COOLDOWN_GAMES = 100;
const MASTERY_THRESHOLD = 0.9;

// KNOWN CORRECTION, not yet implemented (flagged by the user 2026-07-30, after this
// shipped in PR #42): "mastered" below is computed wrong. It currently means "this exact
// word, as a target, was found >=90% of the times this player was ever given it" — an
// aggregate ratio across repeated encounters with the *same* target word. What was
// actually asked for is per-game and letter-weighted: within a *single* game, did the
// player find words whose combined *letter count* reach >=90% of the combined letter
// count of every findable word on that board (e.g. finding 45 of a board's 50 total
// letters-across-possible-words qualifies) — a near-full-clear, not a repeated-target
// solve rate. One clean qualifying game should be enough to trigger the cooldown; it
// should not require the same word to have been a target more than once. Fixing this
// needs lib/game.ts to compute that per-game letter-clear percentage where `possible` and
// the player's found words are already known (guess()'s completion branch, finalizeExpiry,
// giveUp) and pass it through to a revised recordSolved/recordFailed, instead of inferring
// mastery from word_stats' own times_solved/times_failed ratio as done here. Not fixed in
// this session — recorded so a future session builds the right thing, not this.
/** A correct guess of the target word — recorded once, the instant it happens. Also
 *  stamps mastered_at_game_number (this player's total game count right now) the moment
 *  their own solve rate for this word first reaches MASTERY_THRESHOLD — no minimum sample
 *  required here, unlike MIN_ATTEMPTS_FOR_DIFFICULTY below: a single clean solve (1/1) is
 *  already a legitimate personal signal for "don't serve me this again next turn," whereas
 *  that other threshold guards against *sparse aggregate* data across many different
 *  players being mistaken for a real difficulty signal — a different problem.
 *  (See the KNOWN CORRECTION comment above this function — the *criterion* itself is
 *  provisional/wrong, independent of the above reasoning about sample size.) */
export async function recordSolved(
  sql: Sql,
  playerId: string | null,
  wordlistId: number,
  word: string,
): Promise<void> {
  if (!playerId) return;
  await sql`
    insert into word_stats (player_id, wordlist_id, word, times_solved, mastered_at_game_number)
    values (${playerId}, ${wordlistId}, ${word}, 1,
            (select count(*)::int from games where player_id = ${playerId}))
    on conflict (player_id, wordlist_id, word)
    do update set
      times_solved = word_stats.times_solved + 1,
      mastered_at_game_number = case
        when (word_stats.times_solved + 1)::float
             / (word_stats.times_solved + 1 + word_stats.times_failed) >= ${MASTERY_THRESHOLD}
        then (select count(*)::int from games where player_id = ${playerId})
        else word_stats.mastered_at_game_number
      end
  `;
}

/** A game that ended (expired / given up) without the target ever being found. Clears
 *  mastered_at_game_number back to null if the new failure drops this player's own solve
 *  rate for the word back below MASTERY_THRESHOLD, un-suppressing it. */
export async function recordFailed(
  sql: Sql,
  playerId: string | null,
  wordlistId: number,
  word: string,
): Promise<void> {
  if (!playerId) return;
  await sql`
    insert into word_stats (player_id, wordlist_id, word, times_failed)
    values (${playerId}, ${wordlistId}, ${word}, 1)
    on conflict (player_id, wordlist_id, word)
    do update set
      times_failed = word_stats.times_failed + 1,
      mastered_at_game_number = case
        when word_stats.times_solved::float
             / (word_stats.times_solved + word_stats.times_failed + 1) >= ${MASTERY_THRESHOLD}
        then word_stats.mastered_at_game_number
        else null
      end
  `;
}

/** The default target-word pick (replaces the old plain uniform-random draw): prefers a
 *  word this player has never had as a target before, falling back to any word that isn't
 *  currently in this player's own mastery cooldown, falling back to null (ultimate
 *  cold-start / exhausted-pool case — lib/game.ts falls back further to a plain uniform
 *  pick) only if literally every active word of this length is excluded. One query: the
 *  LEFT JOIN's `ws.word is null` doubles as "never played," and the WHERE excludes only
 *  currently-cooling-down words, so a never-played word is automatically eligible too.
 *  Cost checked directly against production before shipping (2026-07-30): same shape and
 *  same order of magnitude as the plain `order by random() limit 1` this replaces (tens of
 *  milliseconds even at the widest wordlist+length combo, ~41k candidate rows) — Postgres
 *  already had to fully sort the candidate set for every game start before this change. */
export async function pickPersonalizedWord(
  sql: Sql,
  wordlistId: number,
  length: number,
  playerId: string,
): Promise<string | null> {
  const [row] = await sql<{ word: string }[]>`
    select w.word
      from words w
      left join word_stats ws
        on ws.player_id = ${playerId} and ws.wordlist_id = ${wordlistId} and ws.word = w.word
     where w.wordlist_id = ${wordlistId} and w.length = ${length} and w.active
       and not (
         ws.mastered_at_game_number is not null
         and (select count(*)::int from games where player_id = ${playerId}) - ws.mastered_at_game_number
               < ${MASTERY_COOLDOWN_GAMES}
       )
     order by (ws.word is null) desc, random()
     limit 1
  `;
  return row?.word ?? null;
}

// ROADMAP Batch 10 "difficulty rating per word": word_stats already accrues exactly the
// signal this needs — recordSolved/recordFailed only ever fire for a game's *target* word
// (lib/game.ts), so summed across all players it's directly "% of games where the target
// was found." A word that's only ever been a target once or twice would read as an
// artificial 0% or 100%, so both consumers below require a minimum sample before trusting
// the rate.
//
// Known limitation, confirmed against production 2026-07-30: with uniform-random target
// selection over a wordlist this size (hu ~152k, en ~270k words), a single word reaching 5
// attempts takes a very large number of games at hobby-project traffic — production's own
// most-attempted word sat at 1 attempt the day this shipped. getHardestWords() and
// pickEasyWord() are therefore both effectively inert right now (empty / always falling
// back), not merely slow to warm up — this will not visibly self-correct on its own
// timescale. Revisit before relying on either: lower this threshold (weakens the
// anti-noise guarantee above), or seed difficulty from a different signal entirely (e.g.
// word frequency/rarity in the source corpus) rather than waiting on live-play volume.
export const MIN_ATTEMPTS_FOR_DIFFICULTY = 5;
export const EASY_MODE_SUCCESS_THRESHOLD = 0.6;

export interface WordDifficultyRow {
  word: string;
  wordlist: string;
  times_failed: number;
  times_solved: number;
  success_rate: number;
}

/** Words with the lowest aggregate success rate, across all players, scoped per wordlist
 *  since a spelling shared between two languages (ROADMAP 6.1) must not merge its stats.
 *  Admin-only (lib/admin-dashboard.ts) — never exposed to players. */
export async function getHardestWords(limit: number): Promise<WordDifficultyRow[]> {
  const sql = db();
  return sql<WordDifficultyRow[]>`
    select ws.word, wl.code as wordlist,
           sum(ws.times_failed)::int as times_failed,
           sum(ws.times_solved)::int as times_solved,
           (sum(ws.times_solved)::float / (sum(ws.times_solved) + sum(ws.times_failed))) as success_rate
      from word_stats ws
      join wordlists wl on wl.id = ws.wordlist_id
     group by ws.wordlist_id, ws.word, wl.code
    having sum(ws.times_solved) + sum(ws.times_failed) >= ${MIN_ATTEMPTS_FOR_DIFFICULTY}
     order by success_rate asc, times_failed desc, ws.word
     limit ${limit}
  `;
}

/** Picks an active word of the given wordlist+length with a proven high success rate
 *  across every player's past games as its target — the "easy mode" word-selection bias —
 *  excluding this player's own words currently in mastery cooldown (see
 *  pickPersonalizedWord above; "shouldn't come up again for ~100 turns" is a global rule,
 *  not specific to the default/non-easy path). Returns null when nothing yet qualifies;
 *  callers fall back to pickPersonalizedWord. As of 2026-07-30, per MIN_ATTEMPTS_FOR_
 *  DIFFICULTY's own comment above, this is the effectively-always-null branch at this
 *  project's traffic — correct to keep, but not worth further query optimisation here;
 *  pickPersonalizedWord is the one that actually runs on every game start. */
export async function pickEasyWord(
  sql: Sql,
  wordlistId: number,
  length: number,
  playerId: string,
): Promise<string | null> {
  const [row] = await sql<{ word: string }[]>`
    select w.word
      from words w
      join word_stats ws on ws.wordlist_id = w.wordlist_id and ws.word = w.word
     where w.wordlist_id = ${wordlistId} and w.length = ${length} and w.active
       and w.word not in (
         select word from word_stats
          where player_id = ${playerId} and wordlist_id = ${wordlistId}
            and mastered_at_game_number is not null
            and (select count(*)::int from games where player_id = ${playerId}) - mastered_at_game_number
                  < ${MASTERY_COOLDOWN_GAMES}
       )
     group by w.word
    having sum(ws.times_solved) + sum(ws.times_failed) >= ${MIN_ATTEMPTS_FOR_DIFFICULTY}
       and sum(ws.times_solved)::float / (sum(ws.times_solved) + sum(ws.times_failed))
             >= ${EASY_MODE_SUCCESS_THRESHOLD}
     order by random()
     limit 1
  `;
  return row?.word ?? null;
}

interface StatsRow {
  games_played: number;
  completion_rate: number | null;
}

interface AvgScoreRow {
  target_length: number;
  avg_score: number;
}

interface LongestWordRow {
  word: string;
}

const EMPTY_STATS = {
  games_played: 0,
  completion_rate: 0,
  average_score_by_length: {} as Record<number, number>,
  // Kept in the response (unlike per-word failure history, deliberately removed — product
  // decision 2026-07-30, this isn't an educational/practice game) as a candidate data
  // source for a future rotating "did you know" highlight, not a persistent history list.
  longest_word_found: null as string | null,
};

/** No identity (never played, or a stale/missing cookie) reads as an empty stats sheet
 *  rather than an error — same convention as lib/players.ts's getPreferredLength. */
export async function getMyStats(playerId: string | null): Promise<Reply> {
  if (!playerId) return { status: 200, body: EMPTY_STATS };

  const sql = db();

  // "Played to a decision" = finished, given_up, or expired; `active`/`abandoned` games
  // have no verdict yet, so they count toward neither the total nor the rate.
  const [summary] = await sql<StatsRow[]>`
    select count(*)::int as games_played,
           (count(*) filter (where status = 'finished'))::float / nullif(count(*), 0) as completion_rate
      from games
     where player_id = ${playerId} and status in ('finished', 'given_up', 'expired')
  `;

  const avgByLength = await sql<AvgScoreRow[]>`
    select target_length, avg(final_score)::float as avg_score
      from games
     where player_id = ${playerId} and status = 'finished'
     group by target_length
     order by target_length
  `;

  const [longest] = await sql<LongestWordRow[]>`
    select gg.word
      from game_guesses gg
      join games g on g.id = gg.game_id
     where g.player_id = ${playerId} and gg.correct
     order by length(gg.word) desc
     limit 1
  `;

  return {
    status: 200,
    body: {
      games_played: summary?.games_played ?? 0,
      completion_rate: summary?.completion_rate ?? 0,
      average_score_by_length: Object.fromEntries(
        avgByLength.map((row) => [row.target_length, row.avg_score]),
      ),
      longest_word_found: longest?.word ?? null,
    },
  };
}
