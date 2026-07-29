/**
 * Hints (ROADMAP Batch 3.1): one hint type — reveal the first letter of a random unfound
 * word, preferring longer ones — deducting a flat cost from the game's score. Recorded in
 * `game_hints` so the leaderboard (lib/scores.ts) can flag hinted games.
 */
import { getConfig } from "./config.js";
import { db } from "./db.js";
import {
  NOT_FOUND,
  type Reply,
  effectiveScore,
  effectiveStatus,
  findableWords,
  loadGame,
} from "./game.js";
import { letterCount } from "./words.js";

export async function useHint(gameId: string): Promise<Reply> {
  const sql = db();
  const config = await getConfig();
  const game = await loadGame(sql, gameId);
  if (!game) return NOT_FOUND;

  if (effectiveStatus(game, new Date()) !== "active") {
    // ROADMAP 6.2: a code, not display text — the frontend maps this to localised copy.
    return { status: 400, body: { detail: "game_not_active" } };
  }

  const foundRows = await sql<{ word: string }[]>`
    select word from game_guesses where game_id = ${game.id} and correct
  `;
  const found = new Set(foundRows.map((row) => row.word));
  const possible = await findableWords(sql, game.wordlist_id, game.target_word, config.min_word_length);
  const unfound = possible.filter((word) => !found.has(word));

  if (unfound.length === 0) {
    return { status: 400, body: { detail: "no_hintable_words" } };
  }

  // "Prefer longer words": pick uniformly among whichever unfound words are longest,
  // rather than always the single longest — a tie shouldn't resolve the same way twice.
  const maxLength = Math.max(...unfound.map(letterCount));
  const longest = unfound.filter((word) => letterCount(word) === maxLength);
  const word = longest[Math.floor(Math.random() * longest.length)];
  const letter = Array.from(word)[0];

  await sql`
    insert into game_hints (game_id, word, position, letter, cost)
    values (${game.id}, ${word}, 1, ${letter}, ${config.hint_cost})
  `;

  return {
    status: 200,
    body: {
      letter,
      position: 1,
      word_length: letterCount(word),
      cost: config.hint_cost,
      total_score: effectiveScore(game.raw_guess_score, game.hint_cost_total + config.hint_cost),
    },
  };
}
