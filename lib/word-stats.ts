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

/** A correct guess of the target word — recorded once, the instant it happens. Pure
 *  counter; mastery is a separate concern (applyGameMastery below), computed once per
 *  game at its true terminal transition rather than here at find-time, since a player can
 *  keep finding other words for a while after landing the target. */
export async function recordSolved(
  sql: Sql,
  playerId: string | null,
  wordlistId: number,
  word: string,
): Promise<void> {
  if (!playerId) return;
  await sql`
    insert into word_stats (player_id, wordlist_id, word, times_solved)
    values (${playerId}, ${wordlistId}, ${word}, 1)
    on conflict (player_id, wordlist_id, word)
    do update set times_solved = word_stats.times_solved + 1
  `;
}

/** A game that ended (expired / given up) without the target ever being found. Pure
 *  counter, same split from mastery as recordSolved above. */
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
    do update set times_failed = word_stats.times_failed + 1
  `;
}

/** Stamps (or clears) mastered_at_game_number for (player, wordlist, target word) from
 *  this one game's own outcome — the per-game, letter-weighted near-full-clear check
 *  (ROADMAP Batch 10 item 3's KNOWN CORRECTION, fixed 2026-08-19): does the combined
 *  letter count of the words this player found in *this* game reach MASTERY_THRESHOLD of
 *  the combined letter count of every word findable on that board? One qualifying game is
 *  enough — this deliberately does not require the same word to have been a target more
 *  than once, unlike MIN_ATTEMPTS_FOR_DIFFICULTY below (a different problem: guarding
 *  *cross-player aggregate* data against being sparse, not a single player's own signal).
 *  Always overwrites: the most recent game where this word was the target determines
 *  mastery now, not an accumulated times_solved/times_failed ratio — so a below-threshold
 *  game clears any earlier mastery for this exact word, same as a qualifying game re-stamps
 *  it to the current count. Called by lib/game.ts's finalizeWordStats exactly once per
 *  game, after recordSolved/recordFailed has already run for that same game (a full clear
 *  always includes finding the target; a timeout/give-up without it already called
 *  recordFailed) — so the word_stats row is guaranteed to exist and this is a plain
 *  UPDATE, not an upsert. */
export async function applyGameMastery(
  sql: Sql,
  playerId: string | null,
  wordlistId: number,
  word: string,
  letterClearFraction: number,
): Promise<void> {
  if (!playerId) return;
  const masteredAtGameNumber =
    letterClearFraction >= MASTERY_THRESHOLD
      ? (await sql<{ count: number }[]>`
          select count(*)::int as count from games where player_id = ${playerId}
        `)[0].count
      : null;
  await sql`
    update word_stats
       set mastered_at_game_number = ${masteredAtGameNumber}
     where player_id = ${playerId} and wordlist_id = ${wordlistId} and word = ${word}
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
// timescale.
//
// ROADMAP 11.21 (2026-10-29) answers this with a second signal that works at zero traffic:
// corpus word frequency (`words.zipf`, migrations/0026). pickEasyWord uses proven live
// success first, then falls back to common words; the admin hardest-words table shows each
// word's frequency next to its measured success rate. The attempts threshold itself is
// unchanged, so the anti-noise guarantee above still holds.
export const MIN_ATTEMPTS_FOR_DIFFICULTY = 5;
/** Zipf frequency at or above which a word counts as "everyday" for easy mode (wordfreq's
 *  scale: about 3.5 = an ordinary word a native speaker meets weekly; 1 = very rare).
 *  Chosen from the coverage check on 2026-10-29: at 3.5 each target length 5-10 keeps roughly
 *  700-1,500 Hungarian and 900-2,000 English candidates. */
export const EASY_MIN_ZIPF = 3.5;
export const EASY_MODE_SUCCESS_THRESHOLD = 0.6;

export interface WordDifficultyRow {
  word: string;
  wordlist: string;
  times_failed: number;
  times_solved: number;
  success_rate: number;
  /** Corpus frequency (words.zipf); null when the frequency list does not know the word. */
  zipf: number | null;
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
           (sum(ws.times_solved)::float / (sum(ws.times_solved) + sum(ws.times_failed))) as success_rate,
           min(w.zipf)::float as zipf
      from word_stats ws
      join wordlists wl on wl.id = ws.wordlist_id
      left join words w on w.wordlist_id = ws.wordlist_id and w.word = ws.word
     group by ws.wordlist_id, ws.word, wl.code
    having sum(ws.times_solved) + sum(ws.times_failed) >= ${MIN_ATTEMPTS_FOR_DIFFICULTY}
     order by success_rate asc, times_failed desc, ws.word
     limit ${limit}
  `;
}

/** Picks an active word of the given wordlist+length as an "easy mode" target, excluding this
 *  player's own words currently in mastery cooldown (see pickPersonalizedWord above;
 *  "shouldn't come up again for ~100 turns" is a global rule, not specific to the
 *  default/non-easy path). Two signals, strongest first:
 *   1. a proven high success rate across every player's past games (needs
 *      MIN_ATTEMPTS_FOR_DIFFICULTY attempts, which this project's traffic rarely reaches);
 *   2. an everyday word by corpus frequency (words.zipf >= EASY_MIN_ZIPF, ROADMAP 11.21),
 *      which works from day one.
 *  Returns null only when neither yields a word (e.g. frequencies not imported yet); callers
 *  then fall back to pickPersonalizedWord. */
export async function pickEasyWord(
  sql: Sql,
  wordlistId: number,
  length: number,
  playerId: string,
): Promise<string | null> {
  const notInCooldown = sql`
    w.word not in (
      select word from word_stats
       where player_id = ${playerId} and wordlist_id = ${wordlistId}
         and mastered_at_game_number is not null
         and (select count(*)::int from games where player_id = ${playerId}) - mastered_at_game_number
               < ${MASTERY_COOLDOWN_GAMES}
    )
  `;
  const [proven] = await sql<{ word: string }[]>`
    select w.word
      from words w
      join word_stats ws on ws.wordlist_id = w.wordlist_id and ws.word = w.word
     where w.wordlist_id = ${wordlistId} and w.length = ${length} and w.active
       and ${notInCooldown}
     group by w.word
    having sum(ws.times_solved) + sum(ws.times_failed) >= ${MIN_ATTEMPTS_FOR_DIFFICULTY}
       and sum(ws.times_solved)::float / (sum(ws.times_solved) + sum(ws.times_failed))
             >= ${EASY_MODE_SUCCESS_THRESHOLD}
     order by random()
     limit 1
  `;
  if (proven) return proven.word;

  const [common] = await sql<{ word: string }[]>`
    select w.word
      from words w
     where w.wordlist_id = ${wordlistId} and w.length = ${length} and w.active
       and w.zipf >= ${EASY_MIN_ZIPF}
       and ${notInCooldown}
     order by random()
     limit 1
  `;
  return common?.word ?? null;
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
