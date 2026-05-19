"""
Betűvetó - Hungarian Word Game Backend
FastAPI application for serving word game logic
"""

from pydantic import BaseModel
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Dict, Set, Optional
from pathlib import Path
import random
import uvicorn
import os

BASE_DIR = Path(__file__).resolve().parent
# Wordlist should be in the same folder as main.py (or a subfolder)
WORDLIST_PATH = Path(os.getenv("WORDLIST_PATH", str(BASE_DIR / "data" / "magyar-szavak.txt")))

app = FastAPI(
    title="Betűvetó API",
    description="Hungarian word puzzle game backend",
    version="1.0.0"
)

# Enable CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure this properly in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Adjustable constants
FAIL_PROB_INITIAL_MULTIPLIER = 100.0
FAIL_RETRY_MULTIPLIER = 2.0
SUCCESS_MULTIPLIER = 0.5
MIN_REAPPEAR_THRESHOLD = 5

# Global game state
class GameState:
    def __init__(self):
        self.word_set: Set[str] = set()
        self.current_word: str = ""
        self.scrambled_letters: str = ""
        self.correct_guesses: Set[str] = set()
        self.total_score: int = 0
        self.guess_count: int = 0
        self.game_active: bool = False
        
        # New tracking for probability
        self.failed_words: Dict[str, Dict] = {} # word -> {multiplier, last_game_failed}
        self.total_games_played: int = 0
        
        self._load_words()
    
    def _load_words(self):
        """Load Hungarian words from file."""
        try:
            with WORDLIST_PATH.open("r", encoding="utf-8") as file:
                # Limit word length to 15 characters
                self.word_set = {line.strip().upper() for line in file if line.strip() and len(line.strip()) <= 15}
        except FileNotFoundError:
            raise FileNotFoundError(f"Word list not found: {WORDLIST_PATH}")
    
    def start_new_game(self, target_length: int = 7) -> Dict:
        """Start a new game with a random word."""
        self.total_games_played += 1
        
        valid_words = [w for w in self.word_set if len(w) == target_length]
        if not valid_words:
            raise HTTPException(status_code=404, detail=f"No words found with length {target_length}")
        
        # Calculate weights
        weights = []
        for w in valid_words:
            weight = 1.0
            if w in self.failed_words:
                stats = self.failed_words[w]
                # Reappear only after MIN_REAPPEAR_THRESHOLD games
                if self.total_games_played - stats['last_game_failed'] >= MIN_REAPPEAR_THRESHOLD:
                    weight = stats['multiplier']
                else:
                    weight = 0.0 # Do not reappear earlier
            weights.append(weight)
        
        # If all weights are 0 (unlikely but possible), fallback to uniform
        if sum(weights) == 0:
            self.current_word = random.choice(valid_words)
        else:
            self.current_word = random.choices(valid_words, weights=weights, k=1)[0]

        self.scrambled_letters = self._scramble_word(self.current_word)
        self.correct_guesses.clear()
        self.total_score = 0
        self.guess_count = 0
        self.game_active = True
        
        return {
            "scrambled_letters": self.scrambled_letters,
            "target_length": target_length,
            "game_active": True,
            "target_word": self.current_word, # Need this for frontend tracking
            "is_previously_failed": self.current_word in self.failed_words
        }
    
    def guess_word(self, word: str) -> Dict:
        """Process a word guess."""
        if not self.game_active:
            raise HTTPException(status_code=400, detail="Game not active. Start a new game first.")
        
        word = word.strip().upper()
        
        # Handle reveal hint
        if len(word) == 1:
            # Mark as failed if user didn't guess it
            if self.current_word not in self.correct_guesses:
                if self.current_word in self.failed_words:
                    self.failed_words[self.current_word]['multiplier'] *= FAIL_RETRY_MULTIPLIER
                else:
                    self.failed_words[self.current_word] = {
                        'multiplier': FAIL_PROB_INITIAL_MULTIPLIER,
                        'last_game_failed': self.total_games_played
                    }
                self.failed_words[self.current_word]['last_game_failed'] = self.total_games_played

            self.game_active = False
            return {
                "valid": True,
                "can_form": True,
                "already_guessed": False,
                "score": 0,
                "message": f"A teljes szó: {self.current_word}",
                "game_ended": True,
                "target_word": self.current_word
            }
        
        # Check if word exists in dictionary
        if word not in self.word_set:
            return {
                "valid": False,
                "can_form": False,
                "already_guessed": False,
                "score": 0,
                "message": f"Nem ismerek ilyen szót: {word}",
                "game_ended": False
            }
        
        # Check if word can be formed from available letters
        can_form = self._can_form_word(word, self.current_word)
        
        if not can_form:
            return {
                "valid": True,
                "can_form": False,
                "already_guessed": False,
                "score": 0,
                "message": f"Ezekből a betűkből nem rakható ki: {word}",
                "game_ended": False
            }
        
        # Check if already guessed
        if word in self.correct_guesses:
            return {
                "valid": True,
                "can_form": True,
                "already_guessed": True,
                "score": 0,
                "message": f'Ezért a szóért már kaptál pontot. Pontszámod továbbra is {self.total_score}.',
                "game_ended": False
            }
        
        # Valid guess - add score
        score = len(word) ** 2
        self.correct_guesses.add(word)
        self.total_score += score
        self.guess_count += 1
        
        is_target = (word == self.current_word)
        if is_target:
            # Halve probability if guessed right
            if word in self.failed_words:
                self.failed_words[word]['multiplier'] *= SUCCESS_MULTIPLIER
                # Optional: if multiplier gets too low, remove?
                # if self.failed_words[word]['multiplier'] <= 1.0:
                #     del self.failed_words[word]

        return {
            "valid": True,
            "can_form": True,
            "already_guessed": False,
            "score": score,
            "message": f"Helyes! {score} pont, összesen eddig {self.total_score}.",
            "game_ended": False,
            "is_seven_letter": len(word) == 7,
            "is_target": is_target
        }
    
    def _can_form_word(self, this_word: str, from_word: str) -> bool:
        """Check if this_word can be formed from letters in from_word."""
        for char in this_word:
            if from_word.count(char) < this_word.count(char):
                return False
        return True
    
    def get_game_state(self) -> Dict:
        """Get current game state."""
        return {
            "active": self.game_active,
            "current_word": self.current_word,
            "scrambled_letters": self.scrambled_letters,
            "correct_guesses": len(self.correct_guesses),
            "total_score": self.total_score,
            "guess_count": self.guess_count,
            "target_length": 7
        }

    def _scramble_word(self, word: str) -> str:
        """Shuffle letters and avoid returning the original order when possible."""
        if len(word) < 2:
            return word

        letters = list(word)
        scrambled = word

        # Try a few times to avoid returning the same sequence as the source word.
        for _ in range(10):
            random.shuffle(letters)
            candidate = ''.join(letters)
            if candidate != word:
                scrambled = candidate
                break

        return ' '.join(scrambled)
    
    def rescramble_letters(self) -> Dict:
        """Rescramble the current word letters."""
        if not self.game_active:
            raise HTTPException(status_code=400, detail="Game not active")
        
        self.scrambled_letters = self._scramble_word(self.current_word)
        return {
            "scrambled_letters": self.scrambled_letters,
            "message": "Betűk újrakeverve!"
        }

# Global game instance
game_state = GameState()

# API Endpoints
@app.get("/")
async def root():
    """Root endpoint"""
    return {"message": "Betűvetó API - Hungarian Word Game Backend"}

@app.get("/api/words/count")
async def get_word_count():
    """Get total number of words in dictionary"""
    return {"total_words": len(game_state.word_set)}

@app.get("/api/words/lengths")
async def get_available_lengths():
    """Get available word lengths in dictionary"""
    lengths = set(len(word) for word in game_state.word_set)
    return {"available_lengths": sorted(list(lengths))}

@app.post("/api/game/start")
async def start_game(target_length: int = 7):
    """Start a new game"""
    return game_state.start_new_game(target_length)

class StartGameRequest(BaseModel):
    target_length: Optional[int] = None

class GuessRequest(BaseModel):
    word: str

@app.post("/api/game/start/body")
async def start_game_with_body(request: StartGameRequest):
    """Start a new game using JSON body payload (compatibility endpoint)."""
    target_length = request.target_length if request.target_length is not None else 7
    return game_state.start_new_game(target_length)

@app.post("/api/game/guess")
async def make_guess(request: GuessRequest):
    """Make a word guess"""
    return game_state.guess_word(request.word)

@app.get("/api/game/state")
async def get_current_state():
    """Get current game state"""
    return game_state.get_game_state()

@app.post("/api/game/rescramble")
async def rescramble_letters():
    """Rescramble current word letters"""
    return game_state.rescramble_letters()

@app.post("/api/game/reset")
async def reset_game():
    """Reset the current game"""
    game_state.game_active = False
    return {"message": "Game reset"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
