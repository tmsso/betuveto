import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { betuAPI } from './api/client'
import ReactCanvasConfetti from 'react-canvas-confetti'

const canvasStyles = {
  position: 'fixed',
  pointerEvents: 'none',
  width: '100%',
  height: '100%',
  top: 0,
  left: 0,
  zIndex: 9999,
}

function App() {
  // Game state
  const [gameState, setGameState] = useState(null)
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
  
  // UI state
  const [isGuessShaking, setIsGuessShaking] = useState(false)
  const [guessErrorMsg, setGuessErrorMsg] = useState(null)
  const [isSparkling, setIsSparkling] = useState(false)
  const [justFoundWord, setJustFoundWord] = useState(null) // New state for glowing word
  const [isAnimatingLetters, setIsAnimatingLetters] = useState(false)
  const [currentAnimatingIndex, setCurrentAnimatingIndex] = useState(-1)
  const [isScoreFlashing, setIsScoreFlashing] = useState(false)

  // Confetti instance
  const refAnimationInstance = useRef(null)
  const getInstance = useCallback((instance) => {
    refAnimationInstance.current = instance
  }, [])

  const makeShot = useCallback((particleRatio, opts) => {
    refAnimationInstance.current &&
      refAnimationInstance.current({
        ...opts,
        origin: { y: 0.7 },
        particleCount: Math.floor(200 * particleRatio),
      })
  }, [])

  const fireConfetti = useCallback(() => {
    makeShot(0.25, { spread: 26, startVelocity: 55 })
    makeShot(0.2, { spread: 60 })
    makeShot(0.35, { spread: 100, decay: 0.91, scalar: 0.8 })
    makeShot(0.1, { spread: 120, startVelocity: 25, decay: 0.92 })
    makeShot(0.1, { spread: 120, startVelocity: 45 })
  }, [makeShot])
  
  const fireExplosion = useCallback(() => {
    makeShot(0.7, { spread: 200, startVelocity: 60, decay: 0.92, scalar:2, gravity:1.5 });
    makeShot(0.5, { spread: 150, startVelocity: 40, decay: 0.95, scalar: 1.5, ticks: 100 });
  }, [makeShot])


  // --- Game Logic Functions --- //

  const showTemporaryError = (msg) => {
    setGuessErrorMsg(msg)
    setIsGuessShaking(true)
    setTimeout(() => {
        setIsGuessShaking(false)
        setGuessErrorMsg(null)
    }, 2000)
  }

  // Clear the glowing effect after a short delay
  useEffect(() => {
    if (justFoundWord) {
      const timer = setTimeout(() => {
        setJustFoundWord(null)
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [justFoundWord])

  const totalScore = foundWords.reduce((sum, word) => sum + word.length * word.length, 0)
  const displayScore = isTimeUp ? scoreAtExpiry : totalScore

  // Timer countdown effect
  useEffect(() => {
    let interval
    if (isTimerActive && timeLeft > 0) {
      interval = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            setIsTimerActive(false)
            setIsTimeUp(true)
            setScoreAtExpiry(totalScore)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    }
    return () => clearInterval(interval)
  }, [isTimerActive, timeLeft, totalScore])

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

  const handleSubmit = useCallback(async () => {
    if (!currentGuess.trim()) return

    try {
      const response = await betuAPI.makeGuess(currentGuess)
      
      setGuessCount((prevCount) => prevCount + 1);

      if (response.valid && response.can_form) {
        if (!response.already_guessed) {
          if (!isTimeUp) {
            setFoundWords((prevWords) => [...prevWords, currentGuess])
            // Trigger the glow for the new word
            setJustFoundWord(currentGuess)

            if (response.is_seven_letter || currentGuess.length === scrambledLetters.filter(l => l !== ' ').length) {
              fireExplosion()
              setIsSparkling(true); 
              setTimeout(() => setIsSparkling(false), 2000);
            } else {
              fireConfetti()
            }
          } else {
            // Time's up - flash score to indicate no points added
            setIsScoreFlashing(true)
            setTimeout(() => setIsScoreFlashing(false), 500)
          }
          setCurrentGuess('')
        } else {
          showTemporaryError(`Ezt a szót már kitaláltad: ${currentGuess}`)
        }
      } else {
        showTemporaryError(`Nincs ilyen szó: ${currentGuess}`)
      }
      
      // Only focus input on wider screens (desktop) to prevent mobile keyboard popup
      if (window.innerWidth >= 640) {
        document.getElementById('guess-input')?.focus() 
      } else {
        document.getElementById('guess-input')?.blur()
      }
    } catch (err) {
      console.error('Error submitting guess:', err)
      showTemporaryError('Hiba történt a tipp küldésekor.')
      setCurrentGuess('') 
      // Safe to focus on error? logic implies we might want to retry, but adhere to consistent mobile behavior
      if (window.innerWidth >= 640) {
        document.getElementById('guess-input')?.focus()
      } else {
        document.getElementById('guess-input')?.blur()
      }
    }
  }, [currentGuess, scrambledLetters, fireExplosion, fireConfetti, isTimeUp])

  const startNewGame = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)
      const response = await betuAPI.startGame()
      setGameState(response)
      setScrambledLetters(response.scrambled_letters.split(' '))
      setFoundWords([])
      setCurrentGuess('')
      setGuessCount(0)
      setJustFoundWord(null)
      setTimeLeft(180)
      setIsTimerActive(false)
      setIsAnimatingLetters(true)
      setCurrentAnimatingIndex(-1)
      setIsTimeUp(false)
      setScoreAtExpiry(0)
      
      if (window.innerWidth >= 640) {
        document.getElementById('guess-input')?.focus();
      }
    } catch (err) {
      setError('Hiba történt az új játék indításakor.')
      console.error('Error starting game:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    startNewGame()
  }, [startNewGame])

  const handleLetterClick = (letter) => {
    setCurrentGuess((prevGuess) => prevGuess + letter)
    if (window.innerWidth >= 640) {
        document.getElementById('guess-input')?.focus()
    }
  }

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
        {/* Score and New Game Button */}
        <div className="flex justify-between items-center mb-6">
          <div className="text-left">
            <div className={`text-3xl font-bold ${isScoreFlashing ? 'animate-pulse text-red-600' : 'text-game-primary'}`}>
              🏆 {displayScore} <span className="hidden sm:inline">pont</span>
            </div>
            <div className="text-md text-gray-500">
              {foundWords.length} talált szó
            </div>
          </div>
          <div className="flex items-center justify-center space-x-2">
            <div className={`text-2xl font-bold ${timeLeft < 60 ? 'text-red-600 animate-pulse' : 'text-game-primary'}`}>
              ⏳ {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
            </div>
          </div>
        </div>

        {/* Scrambled letters */}
        <div className="mb-8 text-center">
          <h3 className="text-2xl font-bold text-game-primary mb-4">Betűk:</h3>
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
              onChange={(e) => setCurrentGuess(e.target.value.toUpperCase())}
              className={
                `w-full min-h-[70px] bg-game-paper border-4 rounded-lg p-5 text-4xl font-extrabold text-game-primary text-center uppercase 
                shadow-inner focus:outline-none focus:ring-4 focus:ring-game-secondary 
                ${isGuessShaking ? 'animate-shake border-game-error bg-red-50 ' : 'border-game-border'}`
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

        {/* Submit Button */}
        <div className="text-center mb-6">
          <button
            onClick={handleSubmit}
            disabled={!currentGuess.trim()}
            className={`w-20 h-20 rounded-full flex items-center justify-center text-4xl 
              shadow-lg transition-all transform 
              ${currentGuess.trim()
                ? 'bg-game-success hover:bg-green-600 hover:scale-110 active:scale-95'
                : 'bg-gray-300 cursor-not-allowed text-gray-500'
              }`}
          >
            ✅
          </button>
        </div>

        {/* New Game Button (relocated) */}
        <div className="text-right mb-6">
          <button
            onClick={startNewGame}
            className="bg-game-secondary text-white text-lg px-6 py-3 rounded-full shadow-lg hover:bg-blue-600 transition-all transform hover:scale-105 active:scale-95 whitespace-nowrap"
          >
            🎲 Új Játék
          </button>
        </div>

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

        {/* Temporary info/error messages */}
        {error && (
          <div className={`mt-6 p-4 rounded-lg text-center font-semibold ${
            error.includes('újrakeverve') ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'
          }`}>
            {error}
          </div>
        )}
      </div>
    </div>
  )
}

export default App