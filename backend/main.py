"""
Betűvető - Hungarian Word Game Backend
FastAPI application for serving word game logic.

Game state is keyed by a server-generated ``game_id`` so concurrent players do
not clobber each other, and the target word / full solution list are never sent
to the client while a game is active.
"""

import os
import random
import threading
import time
import uuid
from pathlib import Path
from typing import Dict, List, Optional, Set

import uvicorn
from fastapi import FastAPI, HTTPException, Path as PathParam, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

BASE_DIR = Path(__file__).resolve().parent
# The wordlist lives once, at the repository root (``data/``). The HF/Docker
# deployment sets WORDLIST_PATH explicitly.
WORDLIST_PATH = Path(
    os.getenv("WORDLIST_PATH", str(BASE_DIR.parent / "data" / "magyar-szavak.txt"))
)

# --- Tunable constants -----------------------------------------------------
MIN_WORD_LENGTH = 3          # shortest accepted / counted guess
MAX_WORD_LENGTH = 15         # longest word loaded from the dictionary
MIN_TARGET_LENGTH = 5        # shortest board length a game may request
MAX_TARGET_LENGTH = 10       # longest board length a game may request
DEFAULT_TARGET_LENGTH = 7
GAME_DURATION_SECONDS = 180  # server-enforced countdown
GAME_TTL_SECONDS = 30 * 60   # abandoned games are swept this long after start

# Failed-word reappearance weighting (process-global for now; Batch 1 moves it
# per-player into the database).
FAIL_PROB_INITIAL_MULTIPLIER = 100.0
FAIL_RETRY_MULTIPLIER = 2.0
SUCCESS_MULTIPLIER = 0.5
MIN_REAPPEAR_THRESHOLD = 5

app = FastAPI(
    title="Betűvető API",
    description="Hungarian word puzzle game backend",
    version="1.1.0",
)

# CORS: an explicit allowlist is required because we send credentials.
# ``allow_origins=["*"]`` together with ``allow_credentials=True`` is rejected
# by browsers, so read a comma-separated allowlist from the environment.
_cors_origins = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Game:
    """A single in-progress (or finished) game, identified by ``id``."""

    def __init__(
        self,
        target_word: str,
        scrambled_letters: str,
        possible_words: List[str],
        target_length: int,
        is_previously_failed: bool,
    ):
        self.id: str = str(uuid.uuid4())
        self.target_word: str = target_word
        self.scrambled_letters: str = scrambled_letters
        self.possible_words: Set[str] = set(possible_words)
        self.possible_count: int = len(possible_words)
        self.target_length: int = target_length
        self.is_previously_failed: bool = is_previously_failed

        self.correct_guesses: Set[str] = set()
        self.total_score: int = 0
        self.guess_count: int = 0

        self.started_at: float = time.time()
        self.ends_at: float = self.started_at + GAME_DURATION_SECONDS
        # active | finished | given_up | expired
        self.status: str = "active"
        self.lock = threading.Lock()

    def is_expired(self) -> bool:
        return time.time() > self.ends_at


class GameManager:
    """Owns the dictionary and the set of live games."""

    def __init__(self):
        self.word_set: Set[str] = set()
        self.words_by_length: Dict[int, List[str]] = {}
        self.games: Dict[str, Game] = {}
        self.failed_words: Dict[str, Dict] = {}
        self.total_games_played: int = 0
        self._lock = threading.Lock()
        self._load_words()

    # -- dictionary ---------------------------------------------------------
    def _load_words(self) -> None:
        try:
            with WORDLIST_PATH.open("r", encoding="utf-8") as file:
                for line in file:
                    word = line.strip().upper()
                    if word and len(word) <= MAX_WORD_LENGTH:
                        self.word_set.add(word)
        except FileNotFoundError as exc:
            raise FileNotFoundError(f"Word list not found: {WORDLIST_PATH}") from exc

        for word in self.word_set:
            self.words_by_length.setdefault(len(word), []).append(word)

    @staticmethod
    def _can_form_word(this_word: str, from_word: str) -> bool:
        """True if ``this_word`` can be built from the letters of ``from_word``."""
        for char in set(this_word):
            if from_word.count(char) < this_word.count(char):
                return False
        return True

    def _possible_words(self, target: str) -> List[str]:
        return [
            word
            for word in self.word_set
            if MIN_WORD_LENGTH <= len(word) <= len(target)
            and self._can_form_word(word, target)
        ]

    @staticmethod
    def _scramble_word(word: str) -> str:
        """Shuffle letters, avoiding the original order when possible."""
        if len(word) < 2:
            return word
        letters = list(word)
        for _ in range(10):
            random.shuffle(letters)
            candidate = "".join(letters)
            if candidate != word:
                return " ".join(candidate)
        return " ".join(letters)

    def _sweep_expired(self) -> None:
        """Drop games whose TTL has elapsed (called under ``self._lock``)."""
        cutoff = time.time() - GAME_TTL_SECONDS
        stale = [gid for gid, game in self.games.items() if game.started_at < cutoff]
        for gid in stale:
            self.games.pop(gid, None)

    def _get_game(self, game_id: str) -> Game:
        game = self.games.get(game_id)
        if game is None:
            raise HTTPException(
                status_code=404, detail="Game not found or expired. Start a new game."
            )
        return game

    # -- game lifecycle -----------------------------------------------------
    def start_new_game(self, target_length: int) -> Dict:
        with self._lock:
            self.total_games_played += 1
            self._sweep_expired()

            valid_words = self.words_by_length.get(target_length, [])
            if not valid_words:
                raise HTTPException(
                    status_code=404,
                    detail=f"No words found with length {target_length}",
                )

            weights = []
            for word in valid_words:
                weight = 1.0
                stats = self.failed_words.get(word)
                if stats:
                    if (
                        self.total_games_played - stats["last_game_failed"]
                        >= MIN_REAPPEAR_THRESHOLD
                    ):
                        weight = stats["multiplier"]
                    else:
                        weight = 0.0  # do not let it reappear too soon
                weights.append(weight)

            if sum(weights) == 0:
                target_word = random.choice(valid_words)
            else:
                target_word = random.choices(valid_words, weights=weights, k=1)[0]

            game = Game(
                target_word=target_word,
                scrambled_letters=self._scramble_word(target_word),
                possible_words=self._possible_words(target_word),
                target_length=target_length,
                is_previously_failed=target_word in self.failed_words,
            )
            self.games[game.id] = game

        return {
            "game_id": game.id,
            "scrambled_letters": game.scrambled_letters,
            "target_length": target_length,
            "game_active": True,
            "ends_at": game.ends_at,
            "duration_seconds": GAME_DURATION_SECONDS,
            "possible_count": game.possible_count,
            "is_previously_failed": game.is_previously_failed,
        }

    def _mark_failed(self, word: str) -> None:
        stats = self.failed_words.get(word)
        if stats:
            stats["multiplier"] *= FAIL_RETRY_MULTIPLIER
            stats["last_game_failed"] = self.total_games_played
        else:
            self.failed_words[word] = {
                "multiplier": FAIL_PROB_INITIAL_MULTIPLIER,
                "last_game_failed": self.total_games_played,
            }

    def guess_word(self, game_id: str, word: str) -> Dict:
        game = self._get_game(game_id)
        with game.lock:
            if game.status != "active":
                raise HTTPException(
                    status_code=400, detail="Game is not active. Start a new game."
                )
            if game.is_expired():
                game.status = "expired"
                return {
                    "valid": False,
                    "can_form": False,
                    "already_guessed": False,
                    "score": 0,
                    "message": "Lejárt az idő.",
                    "game_ended": True,
                    "total_score": game.total_score,
                    "found_count": len(game.correct_guesses),
                }

            word = word.strip().upper()

            if len(word) < MIN_WORD_LENGTH:
                return {
                    "valid": False,
                    "can_form": False,
                    "already_guessed": False,
                    "score": 0,
                    "message": f"Legalább {MIN_WORD_LENGTH} betűs szót adj meg.",
                    "game_ended": False,
                }

            if word not in self.word_set:
                return {
                    "valid": False,
                    "can_form": False,
                    "already_guessed": False,
                    "score": 0,
                    "message": f"Nem ismerek ilyen szót: {word}",
                    "game_ended": False,
                }

            if not self._can_form_word(word, game.target_word):
                return {
                    "valid": True,
                    "can_form": False,
                    "already_guessed": False,
                    "score": 0,
                    "message": f"Ezekből a betűkből nem rakható ki: {word}",
                    "game_ended": False,
                }

            if word in game.correct_guesses:
                return {
                    "valid": True,
                    "can_form": True,
                    "already_guessed": True,
                    "score": 0,
                    "message": (
                        "Ezért a szóért már kaptál pontot. "
                        f"Pontszámod továbbra is {game.total_score}."
                    ),
                    "game_ended": False,
                }

            # Valid, new, formable guess.
            score = len(word) ** 2
            game.correct_guesses.add(word)
            game.total_score += score
            game.guess_count += 1

            is_target = word == game.target_word
            if is_target and word in self.failed_words:
                self.failed_words[word]["multiplier"] *= SUCCESS_MULTIPLIER

            game_ended = len(game.correct_guesses) >= game.possible_count
            if game_ended:
                game.status = "finished"

            return {
                "valid": True,
                "can_form": True,
                "already_guessed": False,
                "score": score,
                "message": f"Helyes! {score} pont, összesen eddig {game.total_score}.",
                "game_ended": game_ended,
                "is_full_length": len(word) == game.target_length,
                "is_target": is_target,
                "total_score": game.total_score,
                "found_count": len(game.correct_guesses),
            }

    def give_up(self, game_id: str) -> Dict:
        game = self._get_game(game_id)
        with game.lock:
            if game.status == "active" and game.target_word not in game.correct_guesses:
                self._mark_failed(game.target_word)
            game.status = "given_up"
            return {
                "target_word": game.target_word,
                "possible_words": sorted(game.possible_words),
                "message": f"A teljes szó: {game.target_word}",
            }

    def rescramble(self, game_id: str) -> Dict:
        game = self._get_game(game_id)
        with game.lock:
            if game.status != "active":
                raise HTTPException(status_code=400, detail="Game is not active.")
            game.scrambled_letters = self._scramble_word(game.target_word)
            return {
                "scrambled_letters": game.scrambled_letters,
                "message": "Betűk újrakeverve!",
            }

    def get_state(self, game_id: str) -> Dict:
        game = self._get_game(game_id)
        # An expired game reports itself as finished so the client can react.
        status = game.status
        if status == "active" and game.is_expired():
            status = "expired"
        return {
            "game_id": game.id,
            "active": status == "active",
            "status": status,
            "scrambled_letters": game.scrambled_letters,
            "found_count": len(game.correct_guesses),
            "possible_count": game.possible_count,
            "total_score": game.total_score,
            "guess_count": game.guess_count,
            "target_length": game.target_length,
            "ends_at": game.ends_at,
        }

    def get_possible_words(self, game_id: str) -> Dict:
        """The full solution list — only once the game is no longer active."""
        game = self._get_game(game_id)
        is_active = game.status == "active" and not game.is_expired()
        if is_active:
            raise HTTPException(
                status_code=403,
                detail="Possible words are only available after the game ends.",
            )
        return {"possible_words": sorted(game.possible_words)}

    def get_possible_count(self, game_id: str) -> Dict:
        game = self._get_game(game_id)
        return {"possible_count": game.possible_count}


# Global manager instance (dictionary is loaded once at startup).
manager = GameManager()


# --- Request models --------------------------------------------------------
class GuessRequest(BaseModel):
    word: str


# --- API endpoints ---------------------------------------------------------
@app.get("/")
async def root():
    return {"message": "Betűvető API - Hungarian Word Game Backend"}


@app.get("/api/words/count")
async def get_word_count():
    return {"total_words": len(manager.word_set)}


@app.get("/api/words/lengths")
async def get_available_lengths():
    lengths = sorted(manager.words_by_length.keys())
    return {"available_lengths": lengths}


@app.post("/api/game/start")
async def start_game(
    target_length: int = Query(
        DEFAULT_TARGET_LENGTH, ge=MIN_TARGET_LENGTH, le=MAX_TARGET_LENGTH
    ),
):
    return manager.start_new_game(target_length)


@app.post("/api/game/{game_id}/guess")
async def make_guess(request: GuessRequest, game_id: str = PathParam(...)):
    return manager.guess_word(game_id, request.word)


@app.post("/api/game/{game_id}/give_up")
async def give_up(game_id: str = PathParam(...)):
    return manager.give_up(game_id)


@app.post("/api/game/{game_id}/rescramble")
async def rescramble(game_id: str = PathParam(...)):
    return manager.rescramble(game_id)


@app.get("/api/game/{game_id}")
async def get_game_state(game_id: str = PathParam(...)):
    return manager.get_state(game_id)


@app.get("/api/game/{game_id}/possible_words")
async def get_possible_words(game_id: str = PathParam(...)):
    return manager.get_possible_words(game_id)


@app.get("/api/game/{game_id}/possible_words/count")
async def get_possible_count(game_id: str = PathParam(...)):
    return manager.get_possible_count(game_id)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
