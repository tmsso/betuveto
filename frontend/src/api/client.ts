/**
 * Betűvetó API Client
 * Hungarian word puzzle game API utilities
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

export interface GameState {
  active: boolean;
  current_word: string;
  scrambled_letters: string;
  correct_guesses: number;
  total_score: number;
  guess_count: number;
  target_length: number;
}

export interface GameResult {
  valid: boolean;
  can_form: boolean;
  already_guessed: boolean;
  score: number;
  message: string;
  game_ended?: boolean;
  is_seven_letter?: boolean;
}

export interface WordStats {
  total_words: number;
  available_lengths: number[];
}

class BetuAPIClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  // Word statistics
  async getWordStats(): Promise<WordStats> {
    const response = await fetch(`${this.baseUrl}/words/count`);
    if (!response.ok) throw new Error('Failed to fetch word stats');
    return response.json();
  }

  async getAvailableLengths(): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/words/lengths`);
    if (!response.ok) throw new Error('Failed to fetch available lengths');
    const data = await response.json();
    return data.available_lengths;
  }

  // Game management
  async startGame(targetLength: number = 7): Promise<{ scrambled_letters: string; target_length: number; game_active: boolean }> {
    const params = new URLSearchParams({ target_length: String(targetLength) });
    let response = await fetch(`${this.baseUrl}/game/start?${params.toString()}`, {
      method: 'POST',
    });

    // Compatibility fallback for deployments expecting JSON body payload
    if (!response.ok) {
      response = await fetch(`${this.baseUrl}/game/start/body`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_length: targetLength })
      });
    }

    if (!response.ok) throw new Error('Failed to start game');
    return response.json();
  }

  async makeGuess(word: string): Promise<GameResult> {
    const response = await fetch(`${this.baseUrl}/game/guess`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word })
    });
    if (!response.ok) throw new Error('Failed to make guess');
    return response.json();
  }

  async getGameState(): Promise<GameState> {
    const response = await fetch(`${this.baseUrl}/game/state`);
    if (!response.ok) throw new Error('Failed to fetch game state');
    return response.json();
  }

  async getPossibleWords(): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/game/possible_words`);
    if (!response.ok) throw new Error('Failed to fetch possible words');
    const data = await response.json();
    return data.possible_words;
  }

  async rescrambleLetters(): Promise<{ scrambled_letters: string; message: string }> {
    const response = await fetch(`${this.baseUrl}/game/rescramble`, {
      method: 'POST'
    });
    if (!response.ok) throw new Error('Failed to rescramble letters');
    return response.json();
  }

  async resetGame(): Promise<{ message: string }> {
    const response = await fetch(`${this.baseUrl}/game/reset`, {
      method: 'POST'
    });
    if (!response.ok) throw new Error('Failed to reset game');
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
