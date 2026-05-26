import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { betuAPI } from './api/client'
import ReactCanvasConfetti from 'react-canvas-confetti'
import ConfirmationModal from './ConfirmationModal'

const canvasStyles = {
  position: 'fixed',
  pointerEvents: 'none',
  width: '100%',
  height: '100%',
  top: 0,
  left: 0,
  zIndex: 9999,
}

// Adjustable constants
const TOP_SCORES_COUNT = 3;

function App() {
  // Game state
  const [currentGuess, setCurrentGuess] = useState('')
  const [foundWords, setFoundWords] = useState([])
  const [scrambledLetters, setScrambledLetters] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [guessCount, setGuessCount] = useState(0)
  const [timeLeft, setTimeLeft] = useState(180)
  const [isTimerActive, setIsTimerActive] = useState(false)
  const [isTimeUp, setIsTimeUp] = useState(false)
  const [scoreAtExpiry, setScoreAtExpiry] = useState(0)
  const [isFailedWord, setIsFailedWord] = useState(false)

  // UI state
  const [isGuessShaking, setIsGuessShaking] = useState(false)
  const [guessErrorMsg, setGuessErrorMsg] = useState(null)
  const [justFoundWord, setJustFoundWord] = useState(null)
  const [isAnimatingLetters, setIsAnimatingLetters] = useState(false)
  const [currentAnimatingIndex, setCurrentAnimatingIndex] = useState(-1)
  const [isScoreFlashing, setIsScoreFlashing] = useState(false)
  const [isNewGameModalOpen, setIsNewGameModalOpen] = useState(false)
  const [highScores, setHighScores] = useState([])
  const [showFailedWords, setShowFailedWords] = useState(false)
  const [failedWordsHistory, setFailedWordsHistory] = useState([])
  const [possibleWordsCount, setPossibleWordsCount] = useState(0)
  const [allPossibleWords, setAllPossibleWords] = useState([])
  const [showRemainingWords, setShowRemainingWords] = useState(false)
  const [allPossibleWordsFound, setAllPossibleWordsFound] = useState(false)

  // Confetti ref
  const confettiRef = useRef(null);
  const getInstance = useCallback((instance) => {
    confettiRef.current = instance;
  }, []);

  const fireConfetti = useCallback(() => {
    confettiRef.current?.({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 }
    });
  }, []);

  const fireExplosion = useCallback(() => {
    confettiRef.current?.({
      particleCount: 200,
      spread: 160,
      origin: { y: 0.3 }
    });
  }, []);

  const showTemporaryError = useCallback((msg) => {
    setGuessErrorMsg(msg);
    setIsGuessShaking(true);
    setTimeout(() => {
      setGuessErrorMsg(null);
      setIsGuessShaking(false);
    }, 2000);
  }, []);

  // Load high scores and failed words from localStorage on mount
  useEffect(() => {
    const storedScores = JSON.parse(localStorage.getItem('betuveto_high_scores') || '[]');
    setHighScores(storedScores);

    const storedFailed = JSON.parse(localStorage.getItem('betuveto_failed_words') || '[]');
    setFailedWordsHistory(storedFailed);
  }, []);

  const updateHighScores = useCallback((finalScore) => {
    if (finalScore <= 0) return;
    setHighScores(prev => {
      const newScores = [...prev, { score: finalScore, date: new Date().toLocaleDateString() }]
        .sort((a, b) => b.score - a.score)
        .slice(0, TOP_SCORES_COUNT);
      localStorage.setItem('betuveto_high_scores', JSON.stringify(newScores));
      return newScores;
    });
  }, []);

  const totalScore = foundWords.reduce((sum, word) => sum + word.length * word.length, 0)
  const displayScore = allPossibleWordsFound ? scoreAtExpiry : (isTimeUp ? scoreAtExpiry : totalScore)

  // End of game score tracking
  useEffect(() => {
    if (isTimeUp) {
      updateHighScores(scoreAtExpiry);
    }
  }, [isTimeUp, scoreAtExpiry, updateHighScores]);

  // Main countdown timer
  useEffect(() => {
    let interval;
    if (isTimerActive && timeLeft > 0 && !isTimeUp) {
      interval = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            setIsTimeUp(true);
            setScoreAtExpiry(totalScore);
            setIsTimerActive(false);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isTimerActive, timeLeft, isTimeUp, totalScore]);

  // Check if all words found
  useEffect(() => {
    if (possibleWordsCount > 0 && foundWords.length === possibleWordsCount && !allPossibleWordsFound) {
      setAllPossibleWordsFound(true);
      setIsTimerActive(false);
      // Add remaining seconds to score
      setScoreAtExpiry(totalScore + timeLeft);
      setIsTimeUp(true);
    }
  }, [foundWords, possibleWordsCount, totalScore, timeLeft, allPossibleWordsFound]);

  // Letter reveal animation effect
  useEffect(() => {
    if (!isAnimatingLetters || scrambledLetters.length === 0) return

    const animate = async () => {
      for (let i = 0; i < scrambledLetters.length; i++) {
        setCurrentAnimatingIndex(i)
        await new Promise(resolve => setTimeout(resolve, 100)) // 100ms per letter
      }
      // Animation complete
      setCurrentAnimatingIndex(-1)
      setIsAnimatingLetters(false)
      setIsTimerActive(true) // Start timer after animation
    }

    animate()
  }, [isAnimatingLetters, scrambledLetters])

  const startNewGame = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const response = await betuAPI.startGame()
      setScrambledLetters(response.scrambled_letters.split(' '))
      setFoundWords([])
      setCurrentGuess('')
      setGuessCount(0)
      setJustFoundWord(null)
      setTimeLeft(180)
      setIsTimerActive(false)
      setIsAnimatingLetters(true)
      setAllPossibleWordsFound(false)
      setShowRemainingWords(false)
      setCurrentAnimatingIndex(-1)
      setIsTimeUp(false)
      setScoreAtExpiry(0)
      
      // Fetch possible words count
      const possibleWords = await betuAPI.getPossibleWords()
      setAllPossibleWords(possibleWords)
      setPossibleWordsCount(possibleWords.length)

      // Check if this word was failed before
      const wordRecord = failedWordsHistory.find(f => f.word === response.target_word);
      setIsFailedWord(!!wordRecord && !wordRecord.learned);

      if (window.innerWidth >= 640) {
        document.getElementById('guess-input')?.focus();
      }
    } catch (err) {
      setError('Hiba történt az új játék indításakor.')
      console.error('Error starting game:', err)
    } finally {
      setIsLoading(false)
    }
  }, [failedWordsHistory])

  const handleNewGameClick = () => {
    if (foundWords.length > 0 && !isTimeUp) {
      setIsNewGameModalOpen(true);
    } else {
      startNewGame();
    }
  };

  const recordFailedWord = (word, learned = false) => {
    setFailedWordsHistory(prev => {
      const existing = prev.find(p => p.word === word);
      let next;
      if (existing) {
        next = prev.map(p => p.word === word ? { ...p, learned } : p);
      } else {
        next = [...prev, { word, learned, timestamp: Date.now() }];
      }
      localStorage.setItem('betuveto_failed_words', JSON.stringify(next));
      return next;
    });
  };

  const handleSubmit = useCallback(async () => {
    const guess = currentGuess.trim().toUpperCase()
    if (guess.length < 2) return

    // Pre-check if letters are valid
    const available = scrambledLetters.join('')
    let tempAvailable = [...available]
    let canFormClientSide = true
    for (const char of guess) {
      const idx = tempAvailable.indexOf(char)
      if (idx === -1) {
        canFormClientSide = false
        break
      }
      tempAvailable.splice(idx, 1)
    }

    if (!canFormClientSide) {
      showTemporaryError('Csak a megadott betűket használd!')
      return
    }

    try {
      const response = await betuAPI.makeGuess(guess)
      
      setGuessCount((prevCount) => prevCount + 1);

      if (response.game_ended) {
        setIsTimeUp(true)
        setScoreAtExpiry(totalScore)
        setIsTimerActive(false)
        if (response.message) {
          setError(response.message)
        }
        return
      }

      if (response.valid && response.can_form) {
        if (!response.already_guessed) {
          if (!isTimeUp) {
            setFoundWords((prevWords) => [...prevWords, guess])
            setJustFoundWord(guess)
            
            // If the target word is guessed, mark as learned
            if (response.is_target) {
                recordFailedWord(guess, true);
            }

            if (response.is_seven_letter || guess.length === scrambledLetters.filter(l => l !== ' ').length) {
              fireExplosion()
            } else {
              fireConfetti()
            }
          } else {
            setIsScoreFlashing(true)
            setTimeout(() => setIsScoreFlashing(false), 500)
          }
          setCurrentGuess('')
        } else {
          showTemporaryError(`Ezt a szót már kitaláltad: ${guess}`)
          setCurrentGuess('')
        }
      } else if (!response.can_form) {
        showTemporaryError('Csak a megadott betűket használd!')
        setCurrentGuess('')
      } else {
        showTemporaryError(`Nincs ilyen szó: ${guess}`)
        setCurrentGuess('')
      }

      if (window.innerWidth >= 640) {
        document.getElementById('guess-input')?.focus() 
      } else {
        document.getElementById('guess-input')?.blur()
      }
    } catch (err) {
      console.error('Error submitting guess:', err)
      // Check if it's a 400 error (game ended)
      if (err.message?.includes('400') || err.toString()?.includes('400')) {
        showTemporaryError('A játék véget ért. Indíts újat!')
        setIsTimeUp(true)
      } else {
        showTemporaryError('Hiba történt a tipp küldésekor.')
      }
      setCurrentGuess('') 
      if (window.innerWidth >= 640) {
        document.getElementById('guess-input')?.focus()
      } else {
        document.getElementById('guess-input')?.blur()
      }
    }
  }, [currentGuess, scrambledLetters, fireExplosion, fireConfetti, isTimeUp, totalScore])

  useEffect(() => {
    startNewGame()
  }, []) // Remove startNewGame from deps to prevent infinite loops after adding state deps 


  const handleLetterClick = useCallback((letter) => {
    setCurrentGuess((prevGuess) => prevGuess + letter)
    if (window.innerWidth >= 640) {
        document.getElementById('guess-input')?.focus()
    }
  }, [])

  const handleScramble = useCallback(async () => {
    try {
      const response = await betuAPI.rescrambleLetters()
      setScrambledLetters(response.scrambled_letters.split(' '))
      setCurrentGuess('')
    } catch (err) {
      console.error('Error scrambling letters:', err)
      showTemporaryError('Hiba történt a betűk keverésekor.')
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.id !== 'guess-input') {
        const acceptedKeys = 'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÖŐÚÜŰ '
        if (acceptedKeys.includes(e.key.toUpperCase())) {
            handleLetterClick(e.key.toUpperCase())
            e.preventDefault(); 
        }
      }
      if (e.key === 'Backspace') {
        setCurrentGuess((prevGuess) => prevGuess.slice(0, -1))
        e.preventDefault() 
      } else if (e.key === 'Enter') {
        handleSubmit()
        e.preventDefault() 
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleLetterClick, handleSubmit])

  const usedLetters = useMemo(() => {
    const used = Array(scrambledLetters.length).fill(false)
    const letters = currentGuess.split('')
    for (const letter of letters) {
      const index = scrambledLetters.findIndex((l, i) => l === letter && !used[i])
      if (index !== -1) used[index] = true
    }
    return used
  }, [currentGuess, scrambledLetters])

  if (isLoading) {
    return (
      <div className="min-h-screen bg-game-paper flex items-center justify-center font-sans">
        <div className="text-center">
          <div className="animate-pulse text-4xl text-game-secondary mb-4">Betöltés...</div>
          <p className="text-gray-600">Játék indítása...</p>
        </div>
      </div>
    )
  }

  if (error && !isLoading) {
    return (
        <div className="min-h-screen flex items-center justify-center bg-game-paper p-4 font-sans">
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg text-center max-w-md mx-auto">
                <strong className="font-bold">Hiba!</strong>
                <span className="block sm:inline"> {error}</span>
                <div className="mt-4">
                    <button 
                        onClick={startNewGame}
                        className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
                    >
                        Újraindítás
                    </button>
                </div>
            </div>
        </div>
    );
  }

  return (
    <div className="min-h-screen bg-game-paper p-4 flex flex-col items-center justify-center font-sans text-game-primary">
      <ReactCanvasConfetti ref={getInstance} style={canvasStyles} />
      
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-5xl font-extrabold text-game-primary mb-2 font-hand leading-tight">🔤 Betűvető</h1>
      </div>

      <div className="bg-white rounded-xl shadow-2xl p-6 sm:p-8 max-w-xl w-full border-4 border-game-border relative overflow-hidden">
        {/* Failed word indicator */}
        {isFailedWord && (
            <div className="absolute top-0 right-0 p-2 bg-yellow-100 text-yellow-800 text-xs font-bold rounded-bl-lg border-l-2 border-b-2 border-yellow-200">
                ⚠️ Korábban elhibázott szó
            </div>
        )}

        {/* Score and New Game Button */}
        <div className="flex justify-between items-center mb-6">
          <div className="text-left">
            <div className={`text-3xl font-bold ${isScoreFlashing ? 'animate-pulse text-red-600' : 'text-game-primary'}`}>
              🏆 {displayScore} <span className="hidden sm:inline">pont</span>
            </div>
            <div className={`text-md text-gray-500 transition-all duration-1000 ${allPossibleWordsFound ? 'animate-pulse scale-110 font-bold text-game-success' : ''}`}>
              {foundWords.length} / {possibleWordsCount} talált szó • {guessCount} tipp {allPossibleWordsFound && '✨'}
            </div>
          </div>
          <div className="flex items-center justify-center space-x-2">
            <div className={`text-2xl font-bold ${timeLeft < 60 ? 'text-red-600 animate-pulse' : 'text-game-primary'}`}>
              ⏳ {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
            </div>
          </div>
        </div>

        {/* High Scores (subtle display) - Hidden as per request */}
        {/*
        {highScores.length > 0 && (
          <div className="mb-4 text-xs text-gray-400 flex gap-4 justify-center">
             <span>Top Scores:</span>
             {highScores.map((s, i) => (
                 <span key={i} className="font-bold">#{i+1}: {s.score}</span>
             ))}
          </div>
        )}
        */}

        {/* Scrambled letters */}
        <div className="mb-8 text-center">
          <div className="flex flex-wrap gap-2 sm:gap-3 justify-center max-w-[280px] sm:max-w-none mx-auto">
            {scrambledLetters.map((letter, index) => (
              <button
                key={index}
                onClick={() => handleLetterClick(letter)}
                className={`w-12 h-12 sm:w-14 sm:h-14 rounded-lg flex items-center justify-center text-2xl sm:text-3xl font-extrabold shadow-md transition-all transform active:scale-90 focus:outline-none focus:ring-2 focus:ring-opacity-50
                ${currentAnimatingIndex === index 
                  ? 'animate-pulse ring-4 ring-yellow-400 scale-125 z-10' 
                  : usedLetters[index] 
                    ? 'bg-gray-300 border-gray-400 text-gray-700' 
                    : 'bg-blue-100 border-2 border-blue-300 text-blue-800 hover:bg-blue-200 hover:-translate-y-1 hover:scale-110 focus:ring-blue-500'}`}
                disabled={usedLetters[index]}
              >
                {letter}
              </button>
            ))}
          </div>
        </div>

        {/* Current guess input area */}
        <div className="mb-6 relative">
          
          {/* Temporary Error Overlay */}
          {guessErrorMsg && (
             <div className="absolute -top-10 left-1/2 transform -translate-x-1/2 z-10 w-full text-center">
                <span className="bg-red-500 text-white text-sm font-bold px-3 py-1 rounded shadow-lg animate-fade-out-up">
                  {guessErrorMsg}
                </span>
             </div>
          )}

          <div className="relative">
            <input
              id="guess-input"
              type="text"
              value={currentGuess}
              onChange={(e) => {
                const val = e.target.value.toUpperCase();
                // Limit to 15 characters
                if (val.length <= 15) {
                  setCurrentGuess(val);
                }
              }}
              className={
                `w-full min-h-[70px] bg-game-paper border-4 rounded-lg p-5 font-extrabold text-game-primary text-center uppercase 
                shadow-inner focus:outline-none focus:ring-4 focus:ring-game-secondary 
                ${isGuessShaking ? 'animate-shake border-game-error bg-red-50 ' : 'border-game-border'}
                ${currentGuess.length > 10 ? 'text-2xl sm:text-3xl' : 'text-4xl'}`
              }
              placeholder="tipp"
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
              autoFocus // Auto-focus on load
            />
            {currentGuess && (
              <button
                onClick={() => setCurrentGuess('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 bg-gray-200 hover:bg-gray-300 rounded-full w-10 h-10 flex items-center justify-center text-gray-700 text-xl"
              >
                ✖️
              </button>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div className="mb-6 flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={handleNewGameClick}
              className="h-12 sm:h-14 w-28 sm:w-32 max-[420px]:w-12 rounded-full shadow-lg bg-game-secondary text-white text-sm sm:text-base font-semibold hover:bg-blue-600 transition-all transform hover:scale-105 active:scale-95 whitespace-nowrap inline-flex items-center justify-center gap-2"
            >
              <span>🎲</span>
              <span className="max-[420px]:hidden">Új Játék</span>
            </button>
            <button
              onClick={handleScramble}
              className="h-12 sm:h-14 w-28 sm:w-32 max-[420px]:w-12 rounded-full shadow-lg bg-white border-2 border-game-border text-game-primary text-sm sm:text-base font-semibold hover:bg-gray-100 transition-all transform hover:scale-105 active:scale-95 whitespace-nowrap inline-flex items-center justify-center gap-2"
              aria-label="Betűk keverése"
              title="Betűk keverése"
            >
              <span>🔀</span>
              <span className="max-[420px]:hidden">Kever</span>
            </button>
          </div>

          <button
            onClick={handleSubmit}
            disabled={!currentGuess.trim()}
            className={`h-12 sm:h-14 w-28 sm:w-32 max-[360px]:w-12 rounded-full shadow-lg text-sm sm:text-base font-semibold transition-all transform whitespace-nowrap inline-flex items-center justify-center gap-2
              ${currentGuess.trim()
                ? 'bg-game-success text-white hover:bg-green-600 hover:scale-105 active:scale-95'
                : 'bg-gray-300 cursor-not-allowed text-gray-500'
              }`}
          >
            <span>✅</span>
            <span className="max-[360px]:hidden">OK</span>
          </button>
        </div>

        {/* Failed Words History Button */}
        <div className="mb-6 flex justify-center">
            <button 
                onClick={() => setShowFailedWords(!showFailedWords)}
                className="text-xs text-game-secondary underline hover:text-blue-700"
            >
                {showFailedWords ? 'Elrejtés' : 'Előzmények: elhibázott szavak'}
            </button>
        </div>

        {showFailedWords && failedWordsHistory.length > 0 && (
            <div className="mb-6 p-4 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
                <h4 className="text-sm font-bold mb-2 text-center text-gray-500">Korábbi elhibázott szavak:</h4>
                <div className="flex flex-wrap gap-2 justify-center">
                    {failedWordsHistory.map((f, i) => (
                        <span 
                            key={i} 
                            className={`text-xs px-2 py-1 rounded border ${f.learned ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}
                        >
                            {f.word}
                        </span>
                    ))}
                </div>
            </div>
        )}

        {/* Found words display (Alphabetical Sort) */}
        {foundWords.length > 0 && (
          <div className="mt-8 border-t-2 border-game-border pt-6">
            <h3 className="text-2xl font-bold text-game-primary mb-4 text-center">Talált Szavak:</h3>
            <div className="flex flex-wrap gap-3 justify-center">
              {[...foundWords].sort((a,b) => a.localeCompare(b, 'hu')).map((word, index) => (
                <span
                  key={index}
                  className={`bg-green-100 text-green-800 px-4 py-2 rounded-full text-md font-semibold shadow-sm animate-bounce-in transition-all duration-500
                    ${justFoundWord === word ? 'ring-4 ring-yellow-400 bg-yellow-100 scale-110' : ''}`}
                >
                  {word} ({word.length * word.length} pont)
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Remaining Words Dropdown (Only after game end) */}
        {isTimeUp && allPossibleWords.length > foundWords.length && (
            <div className="mt-6 pt-4 border-t border-dashed border-gray-200">
                <button 
                  onClick={() => setShowRemainingWords(!showRemainingWords)}
                  className="w-full text-center text-sm font-bold text-game-secondary hover:text-blue-700 flex items-center justify-center gap-2"
                >
                  {showRemainingWords ? '🔼 Rejtett szavak elrejtése' : `🔽 Hiányzó szavak megjelenítése (${allPossibleWords.length - foundWords.length} szó)`}
                </button>
                
                {showRemainingWords && (
                    <div className="mt-4 flex flex-wrap gap-2 justify-center">
                        {allPossibleWords
                            .filter(word => !foundWords.includes(word))
                            .sort((a,b) => a.localeCompare(b, 'hu'))
                            .map((word, index) => (
                                <span key={index} className="text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded border border-gray-200">
                                    {word}
                                </span>
                            ))
                        }
                    </div>
                )}
            </div>
        )}

        {/* Temporary info/error messages */}
        {error && (
          <div className={`mt-6 p-4 rounded-lg text-center font-semibold ${
            error.includes('újrakeverve') ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'
          }`}>
            {error}
          </div>
        )}
      </div>

      <ConfirmationModal 
        isOpen={isNewGameModalOpen}
        onClose={() => setIsNewGameModalOpen(false)}
        onConfirm={startNewGame}
        message="A jelenlegi pontszámod elvész."
      />
    </div>
  )
}

export default App
