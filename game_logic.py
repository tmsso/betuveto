"""
Core game logic for Hungarian word puzzle game.
Separated from UI for better maintainability.
"""
from pathlib import Path
import random
from typing import Set


class WordGame:
    """Hungarian word puzzle game engine."""
    
    def __init__(self, wordlist_path: Path, target_length: int = 7):
        """
        Initialize the game.
        
        Args:
            wordlist_path: Path to the word list file
            target_length: Length of target words to use
        """
        self.wordlist_path = wordlist_path
        self.target_length = target_length
        self.word_set: Set[str] = set()
        self.current_word: str = ""
        self.scrambled_letters: str = ""
        self.correct_guesses: Set[str] = set()
        self.total_score: int = 0
        self.game_active: bool = False
        
        self._load_words()
    
    def _load_words(self):
        """Load word list from file into memory-efficient set."""
        try:
            with self.wordlist_path.open("r", encoding="utf-8") as file:
                self.word_set = {line.strip().upper() for line in file 
                               if line.strip()}
        except FileNotFoundError:
            raise FileNotFoundError(f"Word list not found: {self.wordlist_path}")
    
    def start_new_game(self) -> str:
        """Start a new game with a random word."""
        # Filter words by target length
        valid_words = [w for w in self.word_set if len(w) == self.target_length]
        
        if not valid_words:
            raise ValueError(f"No words found with length {self.target_length}")
        
        self.current_word = random.choice(valid_words)
        self.scrambled_letters = ' '.join(sorted(self.current_word))
        self.correct_guesses.clear()
        self.total_score = 0
        self.game_active = True
        
        return self.scrambled_letters
    
    def guess_word(self, word: str) -> dict:
        """
        Process a word guess.
        
        Returns:
            dict: {
                'valid': bool,           # Is word valid?
                'can_form': bool,        # Can word be formed from letters?
                'already_guessed': bool, # Already guessed this word?
                'score': int,            # Points earned (0 if no points)
                'message': str           # User-friendly message
            }
        """
        if not self.game_active:
            return {
                'valid': False,
                'can_form': False,
                'already_guessed': False,
                'score': 0,
                'message': "Game not active. Start a new game first."
            }
        
        word = word.strip().upper()
        
        # Handle reveal hint
        if len(word) == 1:
            self.game_active = False
            return {
                'valid': True,
                'can_form': True,
                'already_guessed': False,
                'score': 0,
                'message': f"A teljes szó: {self.current_word}"
            }
        
        # Check if word exists in dictionary
        if word not in self.word_set:
            return {
                'valid': False,
                'can_form': False,
                'already_guessed': False,
                'score': 0,
                'message': f"Nem ismerek ilyen szót: {word}"
            }
        
        # Check if word can be formed from available letters
        can_form = self._can_form_word(word, self.current_word)
        
        if not can_form:
            return {
                'valid': True,
                'can_form': False,
                'already_guessed': False,
                'score': 0,
                'message': f"Ezekből a betűkből nem rakható ki: {word}"
            }
        
        # Check if already guessed
        if word in self.correct_guesses:
            return {
                'valid': True,
                'can_form': True,
                'already_guessed': True,
                'score': 0,
                'message': f'Ezért a szóért már kaptál pontot. Pontszámod továbbra is {self.total_score}.'
            }
        
        # Valid guess - add score
        score = len(word) ** 2
        self.correct_guesses.add(word)
        self.total_score += score
        
        return {
            'valid': True,
            'can_form': True,
            'already_guessed': False,
            'score': score,
            'message': f"Helyes! {score} pont, összesen eddig {self.total_score}."
        }
    
    def _can_form_word(self, this_word: str, from_word: str) -> bool:
        """Check if this_word can be formed from letters in from_word."""
        for char in this_word:
            if from_word.count(char) < this_word.count(char):
                return False
        return True
    
    def get_game_state(self) -> dict:
        """Get current game state."""
        return {
            'active': self.game_active,
            'current_word': self.current_word,
            'scrambled_letters': self.scrambled_letters,
            'correct_guesses': len(self.correct_guesses),
            'total_score': self.total_score,
            'target_length': self.target_length
        }
    
    def end_game(self):
        """End the current game."""
        self.game_active = False