import { useState, useEffect, useRef, useCallback } from 'react'
import { betuAPI } from './api/client'
import ReactCanvasConfetti from 'react-canvas-confetti'

const canvasStyles = {
  position: 'fixed',
  pointerEvents: 'none',
  width: '100%',
  height: '100%',
  top: 0,
  left: 0,
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
  
  // UI state
  const [isGuessShaking, setIsGuessShaking] = useState(false)

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

  const handleSubmit = useCallback(async () => {
    if (!currentGuess.trim()) return // Don't submit empty guesses

    try {
      const response = await betuAPI.makeGuess(currentGuess)
      
      // Increment guess count regardless of outcome
      setGuessCount((prevCount) => prevCount + 1);

      if (response.valid && response.can_form) {
        // Correct guess
        if (!response.already_guessed) {
          setFoundWords((prevWords) => [...prevWords, currentGuess])
          
          // Check for celebration (7-letter word or using all letters)
          if (response.is_seven_letter || currentGuess.length === scrambledLetters.filter(l => l !== ' ').length) {
            fireExplosion()
            setIsSparkling(true); // Trigger subtle glow/sparkle on the letters container
            setTimeout(() => setIsSparkling(false), 2000); // Remove after 2s
          } else {
            fireConfetti()
          }
        } else {
          // Already guessed - shake animation
          setIsGuessShaking(true)
          setTimeout(() => setIsGuessShaking(false), 500)
        }
      } else {
        // Invalid guess - shake animation and clear text immediately. NO OVERLAY.
        setIsGuessShaking(true)
        setTimeout(() => setIsGuessShaking(false), 500)
        // Ensure no error state is set here.
      }
      
      // Clear guess after submission (correct or invalid)
      setCurrentGuess('')
      document.getElementById('guess-input')?.focus() // Keep focus on input
    } catch (err) {
      console.error('Error submitting guess:', err)
      // Only set generic error if the network request fails completely
      // We don't block gameplay, just shake and clear.
      setIsGuessShaking(true)
      setTimeout(() => setIsGuessShaking(false), 500)
      setCurrentGuess('') // Clear guess on API error as well
      document.getElementById('guess-input')?.focus();
    }
  }, [currentGuess, scrambledLetters, fireExplosion, fireConfetti])

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
      // Ensure input always receives focus
      document.getElementById('guess-input')?.focus();
    } catch (err) {
      setError('Hiba történt az új játék indításakor.')
      console.error('Error starting game:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Initialize game on component mount
  useEffect(() => {
    startNewGame()
  }, [startNewGame])

  const handleLetterClick = (letter) => {
    setCurrentGuess((prevGuess) => prevGuess + letter)
    document.getElementById('guess-input')?.focus() // Keep focus on input
  }

  // Global keydown listener for letters (only if input is not focused) and special keys
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Check if the event target is *not* the guess input field
      // This allows direct typing into the input when focused, and global capture otherwise.
      if (e.target.id !== 'guess-input') {
        const acceptedKeys = 'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÖŐÚÜŰ '
        if (acceptedKeys.includes(e.key.toUpperCase())) {
            handleLetterClick(e.key.toUpperCase())
            e.preventDefault(); // Prevent default if key is handled globally
        }
      }
      // Always handle Backspace and Enter globally to ensure consistent behavior
      if (e.key === 'Backspace') {
        setCurrentGuess((prevGuess) => prevGuess.slice(0, -1))
        e.preventDefault() // Prevent browser back/forward
      } else if (e.key === 'Enter') {
        handleSubmit()
        e.preventDefault() // Prevent form submission
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleLetterClick, handleSubmit]) // Dependencies capture latest functions


  // Calculate current score
  const totalScore = foundWords.reduce((sum, word) => sum + word.length * word.length, 0)

  // Loading state UI
  if (isLoading) {
    return (
      <div className="min-h-screen bg-game-paper flex items-center justify-center">
        <div className="text-center">
          <div className="animate-pulse text-4xl text-game-secondary mb-4">Betöltés...</div>
          <p className="text-gray-600">Játék indítása...</p>
        </div>
      </div>
    )
  }

  // Error state UI
  if (error && !isLoading) {
    return (
        <div className="min-h-screen flex items-center justify-center bg-game-paper p-4">
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
        <h1 className="text-5xl font-extrabold text-game-primary mb-2 font-hand leading-tight">🎯 Betűvető</h1>
        <p className="text-xl text-game-secondary italic">Magyar Szójáték</p>
      </div>

      <div className="bg-white rounded-xl shadow-2xl p-8 max-w-xl w-full border-4 border-game-border relative overflow-hidden">
        {/* Score and New Game Button */}
        <div className="flex justify-between items-center mb-6">
          <div className="text-left">
            <div className="text-3xl font-bold text-game-primary">
              🏆 {totalScore} pont
            </div>
            <div className="text-md text-gray-500">
              {foundWords.length} talált szó
            </div>
          </div>
          <button
            onClick={startNewGame}
            className="bg-game-secondary text-white text-lg px-6 py-3 rounded-full shadow-lg hover:bg-blue-600 transition-all transform hover:scale-105 active:scale-95 whitespace-nowrap"
          >
            🎲 Új Játék
          </button>
        </div>

        {/* Scrambled letters */}
        <div className="mb-8 text-center">
          <h3 className="text-2xl font-bold text-game-primary mb-4">Betűk:</h3>
          <div className="grid grid-cols-7 gap-3 justify-items-center">
            {scrambledLetters.map((letter, index) => (
              <button
                key={index}
                onClick={() => handleLetterClick(letter)}
                className="w-14 h-14 bg-blue-100 border-2 border-blue-300 rounded-lg flex items-center justify-center text-3xl font-extrabold text-blue-800 
                           shadow-md hover:bg-blue-200 transition-all transform hover:-translate-y-1 hover:scale-110 active:scale-90 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50"
              >
                {letter}
              </button>
            ))}
          </div>
        </div>

        {/* Current guess input area */}
        <div className="mb-6">
          <h3 className="text-2xl font-bold text-game-primary mb-3 text-center">Jelenlegi Tipp:</h3>
          <div className="relative">
            <input
              id="guess-input"
              type="text"
              value={currentGuess}
              onChange={(e) => setCurrentGuess(e.target.value.toUpperCase())}
              className={
                `w-full min-h-[70px] bg-game-paper border-4 rounded-lg p-5 text-4xl font-extrabold text-game-primary text-center font-hand uppercase 
                shadow-inner focus:outline-none focus:ring-4 focus:ring-game-secondary 
                ${isGuessShaking ? 'animate-shake border-game-error bg-red-50 ' : 'border-game-border'}`
              }
              placeholder="Írj egy magyar szót..."
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
              autoFocus // Auto-focus on load
            />
            {/* Clear button for current guess */}
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

        {/* Found words display */}
        {foundWords.length > 0 && (
          <div className="mt-8 border-t-2 border-game-border pt-6">
            <h3 className="text-2xl font-bold text-game-primary mb-4 text-center">Talált Szavak:</h3>
            <div className="flex flex-wrap gap-3 justify-center">
              {foundWords.map((word, index) => (
                <span
                  key={index}
                  className="bg-green-100 text-green-800 px-4 py-2 rounded-full text-md font-semibold shadow-sm animate-bounce-in"
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