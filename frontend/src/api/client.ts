/**
 * Betűvetó API Client
 * Hungarian word puzzle game API utilities
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api';

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
    const response = await fetch(`${this.baseUrl}/game/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target_length: targetLength })
    });
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
  for (const char of thisWord.toUpperCase()) {
    if (fromWord.toUpperCase().count(char) < thisWord.toUpperCase().count(char)) {
      return false;
    }
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