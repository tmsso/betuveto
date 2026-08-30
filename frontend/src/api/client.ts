/**
 * Betűvető API Client
 * Hungarian word puzzle game API utilities.
 *
 * Game state is keyed server-side by a ``game_id`` returned from ``startGame``;
 * the client stores it and threads it through every subsequent call.
 */

// Frontend and API are same-origin (Vercel serves both) — no base URL to configure.
const API_BASE_URL = '/api';

export interface StartGameResult {
  game_id: string;
  wordlist: string;
  alphabet: string;
  scrambled_letters: string;
  target_length: number;
  game_active: boolean;
  ends_at: number;
  duration_seconds: number;
  possible_count: number;
  /** What actually happened, not just what was requested (ROADMAP Batch 10 easy mode) —
   *  an "easy" request silently falls back to "normal" server-side when no word yet
   *  qualifies, so this reflects the real outcome. */
  difficulty: 'easy' | 'normal';
  /** ROADMAP Batch 10 item 14 — which start-screen controls the admin has left visible.
   *  A hidden control is also forced server-side, so target_length / wordlist / difficulty
   *  above already carry the pinned value. Absent on older deployments → treat as all-true. */
  ui?: {
    show_length_selector: boolean;
    show_wordlist_selector: boolean;
    show_easy_mode: boolean;
  };
  /** Present only on a daily-puzzle game (ROADMAP Batch 10 item 1). `already_graded` marks
   *  a replay whose result won't count toward the streak / leaderboard. */
  daily?: {
    puzzle_date: string;
    already_graded: boolean;
  };
}

export interface DailyLeaderEntry {
  display_name: string;
  final_score: number;
  /** Whether this player found the target word (vs. ran out of time / gave up). */
  completed: boolean;
}

export interface DailyView {
  /** 'YYYY-MM-DD' in Europe/Budapest. */
  puzzle_date: string;
  wordlist: string;
  target_length: number;
  possible_count: number;
  already_played: boolean;
  your_result: { completed: boolean; final_score: number } | null;
  streak: { current: number; best: number };
  leaderboard: DailyLeaderEntry[];
}

export interface GameResult {
  valid: boolean;
  can_form: boolean;
  already_guessed: boolean;
  score: number;
  /** Machine-readable outcome code (ROADMAP 6.2) — frontend maps this to localised copy. */
  result: string;
  game_ended?: boolean;
  is_full_length?: boolean;
  is_target?: boolean;
  total_score?: number;
  found_count?: number;
  /** Time-remaining bonus folded into total_score once game_ended (ROADMAP 3.2). Server-computed. */
  completion_bonus?: number;
  /** Only present when result === 'too_short'. */
  min_length?: number;
}

export interface GameState {
  game_id: string;
  active: boolean;
  status: string;
  scrambled_letters: string;
  found_count: number;
  possible_count: number;
  total_score: number;
  guess_count: number;
  target_length: number;
  ends_at: number;
}

export interface GiveUpResult {
  target_word: string;
  possible_words: string[];
}

export interface TopScoreEntry {
  display_name: string;
  final_score: number;
  ended_at: number;
  /** At least one hint was taken during this game (ROADMAP 3.1). */
  hinted: boolean;
}

export interface TopScoresResult {
  wordlist: string;
  target_length: number;
  period: 'all' | 'week' | 'day';
  top: TopScoreEntry[];
  your_best: { final_score: number; ended_at: number } | null;
}

export interface HintResult {
  letter: string;
  position: number;
  word_length: number;
  cost: number;
  total_score: number;
}

export interface MyStats {
  games_played: number;
  completion_rate: number;
  average_score_by_length: Record<string, number>;
  // Not currently displayed (product decision 2026-07-30: no per-word history shown to
  // players) — kept as a candidate data source for a future rotating highlight/fun-fact.
  longest_word_found: string | null;
}

class BetuAPIClient {
  private baseUrl: string;
  private gameId: string | null = null;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  get currentGameId(): string | null {
    return this.gameId;
  }

  private requireGameId(): string {
    if (!this.gameId) throw new Error('No active game. Start a game first.');
    return this.gameId;
  }

  // Word statistics
  async getWordStats(wordlist?: string): Promise<{ total_words: number }> {
    const params = wordlist ? `?${new URLSearchParams({ wordlist }).toString()}` : '';
    const response = await fetch(`${this.baseUrl}/words/count${params}`);
    if (!response.ok) throw new Error('Failed to fetch word stats');
    return response.json();
  }

  async getAvailableLengths(wordlist?: string): Promise<number[]> {
    const params = wordlist ? `?${new URLSearchParams({ wordlist }).toString()}` : '';
    const response = await fetch(`${this.baseUrl}/words/lengths${params}`);
    if (!response.ok) throw new Error('Failed to fetch available lengths');
    const data = await response.json();
    return data.available_lengths;
  }

  // Player preferences (ROADMAP 2.3). Not under /api/game or /api/words, so no
  // /api/... rewrite alias applies — call the /api/v1 path directly.
  async getPreferredLength(): Promise<number | null> {
    const response = await fetch('/api/v1/me/preferences');
    if (!response.ok) throw new Error('Failed to fetch preferences');
    const data = await response.json();
    return data.preferred_length ?? null;
  }

  async setPreferredLength(length: number): Promise<void> {
    const response = await fetch('/api/v1/me/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferred_length: length }),
    });
    if (!response.ok) throw new Error('Failed to save preferred length');
  }

  // UI language preference (ROADMAP 6.2, migrations/0010) — independent of preferred
  // length/wordlist above, same /me/preferences route.
  async getPreferredLanguage(): Promise<string | null> {
    const response = await fetch('/api/v1/me/preferences');
    if (!response.ok) throw new Error('Failed to fetch preferences');
    const data = await response.json();
    return data.preferred_language ?? null;
  }

  async setPreferredLanguage(language: string): Promise<void> {
    const response = await fetch('/api/v1/me/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferred_language: language }),
    });
    if (!response.ok) throw new Error('Failed to save preferred language');
  }

  // Colour-theme preference (ROADMAP Batch 10 item 7, migrations/0016) — 'light' |
  // 'dark' | 'system', same /me/preferences route. Null = never chosen; the frontend
  // treats that as 'system' (follow the OS prefers-color-scheme).
  async getPreferredTheme(): Promise<string | null> {
    const response = await fetch('/api/v1/me/preferences');
    if (!response.ok) throw new Error('Failed to fetch preferences');
    const data = await response.json();
    return data.preferred_theme ?? null;
  }

  async setPreferredTheme(theme: string): Promise<void> {
    const response = await fetch('/api/v1/me/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preferred_theme: theme }),
    });
    if (!response.ok) throw new Error('Failed to save preferred theme');
  }

  // Sound-effects preference (ROADMAP Batch 10 item 8, migrations/0017) — same
  // /me/preferences route. Null = never chosen; the frontend treats that as off.
  async getSoundEnabled(): Promise<boolean | null> {
    const response = await fetch('/api/v1/me/preferences');
    if (!response.ok) throw new Error('Failed to fetch preferences');
    const data = await response.json();
    return data.sound_enabled ?? null;
  }

  async setSoundEnabled(enabled: boolean): Promise<void> {
    const response = await fetch('/api/v1/me/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sound_enabled: enabled }),
    });
    if (!response.ok) throw new Error('Failed to save sound preference');
  }

  // Game management
  async startGame(targetLength: number = 7, wordlist?: string, difficulty?: 'easy' | 'normal'): Promise<StartGameResult> {
    const params = new URLSearchParams({ target_length: String(targetLength) });
    if (wordlist) params.set('wordlist', wordlist);
    if (difficulty) params.set('difficulty', difficulty);
    const response = await fetch(`${this.baseUrl}/game/start?${params.toString()}`, {
      method: 'POST',
    });
    if (!response.ok) throw new Error('Failed to start game');
    const data: StartGameResult = await response.json();
    this.gameId = data.game_id;
    return data;
  }

  // Daily puzzle (ROADMAP Batch 10 item 1). GET is identity-optional — the puzzle meta
  // and leaderboard come back regardless; your_result/streak are empty without a cookie.
  async getDaily(wordlist?: string, targetLength?: number): Promise<DailyView> {
    const params = new URLSearchParams();
    if (wordlist) params.set('wordlist', wordlist);
    if (targetLength) params.set('target_length', String(targetLength));
    const qs = params.toString();
    const response = await fetch(`${this.baseUrl}/v1/daily${qs ? `?${qs}` : ''}`);
    if (!response.ok) throw new Error(`Failed to fetch daily puzzle (${response.status})`);
    return response.json();
  }

  /** Starts (or replays) today's puzzle. Returns the same shape as startGame plus a
   *  `daily` block, and sets currentGameId the same way — the whole game flow is reused. */
  async startDailyGame(wordlist?: string, targetLength?: number): Promise<StartGameResult> {
    const params = new URLSearchParams();
    if (wordlist) params.set('wordlist', wordlist);
    if (targetLength) params.set('target_length', String(targetLength));
    const qs = params.toString();
    const response = await fetch(`${this.baseUrl}/v1/daily/start${qs ? `?${qs}` : ''}`, {
      method: 'POST',
    });
    if (!response.ok) throw new Error('Failed to start daily game');
    const data: StartGameResult = await response.json();
    this.gameId = data.game_id;
    return data;
  }

  async makeGuess(word: string): Promise<GameResult> {
    const gameId = this.requireGameId();
    const response = await fetch(`${this.baseUrl}/game/${gameId}/guess`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word }),
    });
    if (!response.ok) throw new Error(`Failed to make guess (${response.status})`);
    return response.json();
  }

  async giveUp(): Promise<GiveUpResult> {
    const gameId = this.requireGameId();
    const response = await fetch(`${this.baseUrl}/game/${gameId}/give_up`, {
      method: 'POST',
    });
    if (!response.ok) throw new Error('Failed to give up');
    return response.json();
  }

  /** Reveals the first letter of a random unfound word (preferring longer ones) and
   *  deducts its cost from the running score (ROADMAP 3.1). Throws on 400 (no unfound
   *  words left / game not active) so the caller can show a specific message. */
  async useHint(): Promise<HintResult> {
    const gameId = this.requireGameId();
    const response = await fetch(`${this.baseUrl}/game/${gameId}/hint`, {
      method: 'POST',
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new Error(body?.detail || `Failed to get a hint (${response.status})`);
    }
    return response.json();
  }

  async getGameState(): Promise<GameState> {
    const gameId = this.requireGameId();
    const response = await fetch(`${this.baseUrl}/game/${gameId}`);
    if (!response.ok) throw new Error('Failed to fetch game state');
    return response.json();
  }

  /** Full solution list — only valid once the game has ended. */
  async getPossibleWords(): Promise<string[]> {
    const gameId = this.requireGameId();
    const response = await fetch(`${this.baseUrl}/game/${gameId}/possible_words`);
    if (!response.ok) throw new Error('Failed to fetch possible words');
    const data = await response.json();
    return data.possible_words;
  }

  async rescrambleLetters(): Promise<{ scrambled_letters: string }> {
    const gameId = this.requireGameId();
    const response = await fetch(`${this.baseUrl}/game/${gameId}/rescramble`, {
      method: 'POST',
    });
    if (!response.ok) throw new Error('Failed to rescramble letters');
    return response.json();
  }

  // High scores (ROADMAP Batch 2.2). No game_id needed: "your best" is resolved
  // server-side from the same anon-identity cookie /game/start already relies on, sent
  // automatically by the browser on this same-origin request.
  async getTopScores(targetLength: number = 7, wordlist?: string): Promise<TopScoresResult> {
    const params = new URLSearchParams({ length: String(targetLength) });
    if (wordlist) params.set('wordlist', wordlist);
    const response = await fetch(`${this.baseUrl}/v1/scores/top?${params.toString()}`);
    if (!response.ok) throw new Error(`Failed to fetch top scores (${response.status})`);
    return response.json();
  }

  // Player stats (ROADMAP 3.3): games played, average score per length, longest word,
  // completion rate, and the server-side failed-words list (replaces localStorage).
  async getMyStats(): Promise<MyStats> {
    const response = await fetch('/api/v1/me/stats');
    if (!response.ok) throw new Error(`Failed to fetch stats (${response.status})`);
    return response.json();
  }

  // Word curation (ROADMAP 4.1): flag a found/missing word as wrong. Idempotent — a
  // repeat report for the same word just comes back as already_reported.
  async reportWord(word: string, reason?: string): Promise<{ reported: boolean; already_reported: boolean; deactivated: boolean }> {
    const response = await fetch('/api/v1/words/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reason ? { word, reason } : { word }),
    });
    if (!response.ok) throw new Error(`Failed to report word (${response.status})`);
    return response.json();
  }

  // Word curation (ROADMAP 4.2): suggest a word the dictionary rejected. Idempotent and
  // non-error either way (already in the dictionary vs. genuinely new) — only bad input,
  // missing identity, or the daily rate limit come back as a thrown error.
  async suggestWord(word: string): Promise<{ suggested: boolean; already_present: boolean }> {
    const response = await fetch('/api/v1/words/suggest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word }),
    });
    if (!response.ok) throw new Error(`Failed to suggest word (${response.status})`);
    return response.json();
  }
}

// Export singleton instance
export const betuAPI = new BetuAPIClient();

// Utility functions
export const canFormWord = (thisWord: string, fromWord: string): boolean => {
  const sourceCounts = new Map<string, number>();

  for (const char of fromWord.toUpperCase()) {
    sourceCounts.set(char, (sourceCounts.get(char) ?? 0) + 1);
  }

  for (const char of thisWord.toUpperCase()) {
    const remaining = sourceCounts.get(char) ?? 0;
    if (remaining === 0) {
      return false;
    }
    sourceCounts.set(char, remaining - 1);
  }

  return true;
};

export const calculateScore = (wordLength: number): number => {
  return wordLength * wordLength;
};

export const shuffleWord = (word: string): string => {
  const letters = word.toUpperCase().split('');
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [letters[i], letters[j]] = [letters[j], letters[i]];
  }
  return letters.join('');
};
