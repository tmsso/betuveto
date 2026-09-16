import { useCallback, useEffect, useMemo, useState } from 'react'
import { betuAPI } from '../api/client'

const MIN_GUESS_LENGTH = 3
const MIN_TARGET_LENGTH = 5
const DEFAULT_TARGET_LENGTH = 7
const DEFAULT_WORDLIST = 'hu'
// Mirrors lib/words.ts's durationForLength (ROADMAP 2.3) — duplicated the same way
// api/client.ts already duplicates canFormWord/calculateScore, since the frontend build
// doesn't share modules with the API's lib/. Only used before the first /start response
// arrives; the server's duration_seconds is always the source of truth after that.
const durationForLength = (length) => 120 + 15 * (length - MIN_TARGET_LENGTH)

/**
 * ROADMAP 7.2.1 — the single-game state machine, extracted out of App.jsx (which kept
 * every game-state useState directly, pre-multiplayer). Exposes `beginFromStartResponse`
 * as its own function (not folded into a `startNewGame` that also calls the API) because
 * 7.2.6's room start calls it directly with a room snapshot's `your_game`, bypassing the
 * single-player `/game/start` endpoint entirely — see docs/multiplayer.md §6.
 *
 * What stays OUTSIDE this hook, in App.jsx, and why: `isLoading`/`error` and the
 * `startNewGame` wrapper that owns them (choosing the daily vs. normal endpoint, and
 * syncing the "next game" selectors to a server-forced value) — that orchestration is
 * single-player-specific and doesn't apply to a room start. `selectedLength` /
 * `selectedWordlist` / `selectedEasyMode` / `availableLengths` (preferences for the *next*
 * game, not the active one) and `pendingConfirm` (the confirmation-modal gate) stay for
 * the same reason. The leaderboard/stats/achievements/daily panels stay in App.jsx too —
 * they read this hook's `isTimeUp`/`allPossibleWords` to know when to refetch, but aren't
 * part of the game itself.
 */
export function useGame({ t, play, fireConfetti, fireExplosion }) {
  const [currentGuess, setCurrentGuess] = useState('')
  const [foundWords, setFoundWords] = useState([])
  const [scrambledLetters, setScrambledLetters] = useState([])
  const [guessCount, setGuessCount] = useState(0)
  const [timeLeft, setTimeLeft] = useState(durationForLength(DEFAULT_TARGET_LENGTH))
  const [endsAt, setEndsAt] = useState(null)
  const [isTimerActive, setIsTimerActive] = useState(false)
  const [isTimeUp, setIsTimeUp] = useState(false)
  const [scoreAtExpiry, setScoreAtExpiry] = useState(0)
  // Time-remaining bonus for a full board clear, as computed by the server (ROADMAP
  // 3.2) — read from the winning guess's response, never recomputed from the client's
  // own countdown, so a slow network round-trip can't cost (or gain) bonus seconds.
  const [completionBonus, setCompletionBonus] = useState(0)

  const [isGuessShaking, setIsGuessShaking] = useState(false)
  const [guessErrorMsg, setGuessErrorMsg] = useState(null)
  const [justFoundWord, setJustFoundWord] = useState(null)
  const [isAnimatingLetters, setIsAnimatingLetters] = useState(false)
  const [currentAnimatingIndex, setCurrentAnimatingIndex] = useState(-1)
  const [isScoreFlashing, setIsScoreFlashing] = useState(false)
  // ROADMAP Batch 10 item 17 — `true` means the board is inert: no game has been started
  // yet (first page load) or a config change dropped back here. Nothing is running
  // server-side (no game/start call → no clock); the player presses "Új játék" to begin.
  const [preGame, setPreGame] = useState(true)
  const [targetLength, setTargetLength] = useState(DEFAULT_TARGET_LENGTH)
  // Which start-screen controls the admin has left visible (ROADMAP Batch 10 item 14),
  // echoed by game/start. `null` until the first response — treated as "show everything",
  // matching the pre-feature default and how an older deployment (no `ui` field) behaves.
  const [uiConfig, setUiConfig] = useState(null)
  // Wordlist/language selector (ROADMAP 6.1) — gameWordlist is the just-started game's
  // actual wordlist, echoed back by the server; the leaderboard panel must key off this,
  // not the "next game" selector, or it can show the wrong language's scores for a few
  // seconds after switching the selector but before starting a new game.
  const [gameWordlist, setGameWordlist] = useState(DEFAULT_WORDLIST)
  // Easy mode (ROADMAP Batch 10 "difficulty rating per word") — reflects the server's
  // echoed actual outcome, not the request: an "easy" request can silently fall back to a
  // normal pick server-side if no word yet qualifies.
  const [gameEasyMode, setGameEasyMode] = useState(false)
  // Daily puzzle (ROADMAP Batch 10 item 1) — the *current* game is today's shared puzzle.
  const [isDailyGame, setIsDailyGame] = useState(false)
  // Accepted on-screen-keyboard letters for the active game's wordlist (ROADMAP 6.2),
  // echoed back by game/start. Seeded with hu's own alphabet so the very first render
  // (before any response has arrived) still matches the default wordlist.
  const [gameAlphabet, setGameAlphabet] = useState('ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÖŐÚÜŰ')

  // Hints (ROADMAP 3.1). Mirrors lib/hints.ts's HINT_COST the same way durationForLength
  // mirrors lib/words.ts.
  const [hintPenalty, setHintPenalty] = useState(0)
  const [hintLoading, setHintLoading] = useState(false)
  const [hintMessage, setHintMessage] = useState(null)
  // Word curation (ROADMAP 4.1): session-local, so a flagged chip shows disabled without a
  // round trip — the server itself is the source of truth for "already reported".
  const [reportedWords, setReportedWords] = useState(() => new Set())
  // Word curation (ROADMAP 4.2): the word from the most recently rejected guess, offered
  // back as "maybe this is a real word?" — cleared on the next keystroke or guess.
  const [suggestPrompt, setSuggestPrompt] = useState(null)
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [suggestThanks, setSuggestThanks] = useState(false)
  const [possibleWordsCount, setPossibleWordsCount] = useState(0)
  const [allPossibleWords, setAllPossibleWords] = useState([])
  const [showRemainingWords, setShowRemainingWords] = useState(false)
  const [allPossibleWordsFound, setAllPossibleWordsFound] = useState(false)

  const showTemporaryError = useCallback((msg) => {
    setGuessErrorMsg(msg)
    setIsGuessShaking(true)
    setTimeout(() => {
      setGuessErrorMsg(null)
      setIsGuessShaking(false)
    }, 2000)
  }, [])

  // <GuessInput>'s onChange path (typing): clears any pending word-suggestion prompt on
  // every keystroke. Deliberately distinct from the input's own clear (✖️) button, which
  // does not — that asymmetry predates this component's extraction and is preserved as-is.
  const handleGuessChange = useCallback((val) => {
    setCurrentGuess(val)
    setSuggestPrompt(null)
  }, [])

  const totalScore = foundWords.reduce((sum, word) => sum + word.length * word.length, 0)
  const rawDisplayScore = allPossibleWordsFound ? scoreAtExpiry : (isTimeUp ? scoreAtExpiry : totalScore)
  // Hints (ROADMAP 3.1) deduct from the server's score; the client-side sum above never
  // knows about them, so the penalty is subtracted once, here, at the final display step
  // — floored at 0 the same way the server floors it (lib/game.ts's effectiveScore).
  const displayScore = Math.max(0, rawDisplayScore - hintPenalty)

  // The shared terminal transition every ending path (timer expiry, a game-ending guess,
  // give-up, a full clear) funnels through. `reason === 'completed'` is the only one that
  // sets allPossibleWordsFound (drives the full-clear display); `possibleWords` is only
  // ever passed by give-up (a normal clear/expiry fetches the reveal separately, below).
  const endGame = useCallback((reason, { bonus = 0, possibleWords } = {}) => {
    setIsTimerActive(false)
    setIsTimeUp(true)
    setScoreAtExpiry(totalScore + bonus)
    if (reason === 'completed') setAllPossibleWordsFound(true)
    if (possibleWords) setAllPossibleWords(possibleWords)
  }, [totalScore])

  // The setter block a game/start (or daily/start, or — from 7.2.6 — a room start)
  // response applies to local state. Deliberately separate from any endpoint-choosing
  // wrapper (see this file's top comment) so a caller that already has a start-shaped
  // payload from somewhere else can apply it directly.
  const beginFromStartResponse = useCallback((response, { daily = false } = {}) => {
    setIsDailyGame(daily)
    setPreGame(false) // ROADMAP Batch 10 item 17 — a game is now live; leave the inert board.
    setScrambledLetters(response.scrambled_letters.split(' '))
    setTargetLength(response.target_length ?? DEFAULT_TARGET_LENGTH)
    setGameWordlist(response.wordlist ?? DEFAULT_WORDLIST)
    setGameEasyMode(response.difficulty === 'easy')
    if (response.alphabet) setGameAlphabet(response.alphabet)
    const ui = response.ui ?? null
    setUiConfig(ui)
    setFoundWords([])
    setCurrentGuess('')
    setGuessCount(0)
    setJustFoundWord(null)
    setTimeLeft(response.duration_seconds ?? durationForLength(response.target_length ?? DEFAULT_TARGET_LENGTH))
    setEndsAt(response.ends_at)
    setIsTimerActive(false)
    setIsAnimatingLetters(true)
    setAllPossibleWordsFound(false)
    setShowRemainingWords(false)
    setCurrentAnimatingIndex(-1)
    setIsTimeUp(false)
    setScoreAtExpiry(0)
    setCompletionBonus(0)
    setHintPenalty(0)
    setHintMessage(null)
    // The full solution list is no longer served while a game is active (it would leak
    // the answers). Only the count is known up front; the list is fetched at game end.
    setAllPossibleWords([])
    setPossibleWordsCount(response.possible_count)

    if (window.innerWidth >= 640) {
      document.getElementById('guess-input')?.focus()
    }
    return ui
  }, [])

  // ROADMAP Batch 10 item 17 — drop to the inert pre-game board without starting a game
  // (so no `game/start` call is made and the server clock never begins). This is the
  // reset half of beginFromStartResponse, minus everything that depends on a response.
  const enterPreGame = useCallback(() => {
    setPreGame(true)
    setScrambledLetters([])
    setFoundWords([])
    setCurrentGuess('')
    setGuessCount(0)
    setJustFoundWord(null)
    setPossibleWordsCount(0)
    setAllPossibleWords([])
    setAllPossibleWordsFound(false)
    setShowRemainingWords(false)
    setIsAnimatingLetters(false)
    setCurrentAnimatingIndex(-1)
    setIsTimerActive(false)
    setEndsAt(null)
    setIsTimeUp(false)
    setScoreAtExpiry(0)
    setCompletionBonus(0)
    setHintPenalty(0)
    setHintMessage(null)
    setIsDailyGame(false)
    setGameEasyMode(false) // clears the 🌱 board indicator until the next game echoes one
    setSuggestPrompt(null)
    setSuggestThanks(false)
  }, [])

  // Once the game has ended, fetch the full solution list for the reveal. The server only
  // serves it once it agrees the game is over; right at the deadline (rounding or minor
  // clock skew) it may still return 403, so retry a few times before giving up.
  useEffect(() => {
    if (!isTimeUp) return
    let cancelled = false
    const MAX_ATTEMPTS = 6
    const fetchReveal = async () => {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS && !cancelled; attempt++) {
        try {
          const words = await betuAPI.getPossibleWords()
          if (!cancelled) setAllPossibleWords(words)
          return
        } catch (err) {
          if (attempt >= MAX_ATTEMPTS) {
            console.error('Error fetching possible words:', err)
            return
          }
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
      }
    }
    fetchReveal()
    return () => { cancelled = true }
  }, [isTimeUp])

  // Main countdown timer. The server owns the deadline (`endsAt`, epoch seconds); the
  // client just renders the remaining time, so a slept/backgrounded tab resyncs instead of
  // drifting.
  useEffect(() => {
    if (!isTimerActive || isTimeUp || !endsAt) return
    const tick = () => {
      // Ceil so the countdown only reaches 0 once the server deadline has actually
      // passed — rounding down would end the game up to half a second early.
      const remaining = Math.max(0, Math.ceil(endsAt - Date.now() / 1000))
      setTimeLeft(remaining)
      if (remaining <= 0) endGame('expired')
    }
    tick()
    const interval = setInterval(tick, 500)
    return () => clearInterval(interval)
  }, [isTimerActive, isTimeUp, endsAt, endGame])

  // Check if all words found.
  useEffect(() => {
    if (possibleWordsCount > 0 && foundWords.length === possibleWordsCount && !allPossibleWordsFound) {
      // completionBonus comes from the server's guess response (lib/game.ts), computed
      // from the actual time remaining when the last word was scored.
      endGame('completed', { bonus: completionBonus })
    }
  }, [foundWords, possibleWordsCount, completionBonus, allPossibleWordsFound, endGame])

  // Letter reveal animation effect.
  useEffect(() => {
    if (!isAnimatingLetters || scrambledLetters.length === 0) return

    const animate = async () => {
      for (let i = 0; i < scrambledLetters.length; i++) {
        setCurrentAnimatingIndex(i)
        await new Promise((resolve) => setTimeout(resolve, 100)) // 100ms per letter
      }
      setCurrentAnimatingIndex(-1)
      setIsAnimatingLetters(false)
      setIsTimerActive(true) // Start timer after animation
    }

    animate()
  }, [isAnimatingLetters, scrambledLetters])

  // Hints (ROADMAP 3.1): reveals the first letter of a random unfound word and deducts its
  // cost. ROADMAP 6.2: lib/hints.ts's 400s return a machine-readable code in `detail`
  // (game_not_active / no_hintable_words) — map known codes to localised copy, falling
  // back to a generic message for anything else.
  const hintErrorMessage = useCallback((code) => {
    if (code === 'game_not_active') return t('errors.gameNotActive')
    if (code === 'no_hintable_words') return t('errors.noHintableWords')
    return t('errors.hintFailed')
  }, [t])

  const handleUseHint = useCallback(async () => {
    if (isTimeUp || hintLoading) return
    setHintLoading(true)
    try {
      const result = await betuAPI.useHint()
      setHintPenalty((prev) => prev + result.cost)
      setHintMessage(t('hintMessage', { length: result.word_length, letter: result.letter, cost: result.cost }))
      play('hint')
      setTimeout(() => setHintMessage(null), 5000)
    } catch (err) {
      console.error('Error getting a hint:', err)
      showTemporaryError(hintErrorMessage(err.message))
    } finally {
      setHintLoading(false)
    }
  }, [isTimeUp, hintLoading, showTemporaryError, hintErrorMessage, t, play])

  // Word curation (ROADMAP 4.1): flag a found or missing word as wrong. Idempotent on the
  // server, so a double-click just comes back as already_reported — no need to guard
  // beyond disabling the button once this session has already reported it.
  const handleReportWord = useCallback(async (word) => {
    if (reportedWords.has(word)) return
    try {
      await betuAPI.reportWord(word)
      setReportedWords((prev) => new Set(prev).add(word))
    } catch (err) {
      console.error('Error reporting word:', err)
      showTemporaryError(t('errors.reportFailed'))
    }
  }, [reportedWords, showTemporaryError, t])

  // Word curation (ROADMAP 4.2): offer to submit a rejected guess as a possibly-real word
  // the dictionary is missing. already_present and a genuinely new suggestion both read as
  // the same "thanks" confirmation to the player.
  const handleSuggestWord = useCallback(async (word) => {
    setSuggestLoading(true)
    try {
      await betuAPI.suggestWord(word)
      setSuggestPrompt(null)
      setSuggestThanks(true)
      setTimeout(() => setSuggestThanks(false), 2500)
    } catch (err) {
      console.error('Error suggesting word:', err)
      showTemporaryError(err.message?.includes('429') ? t('errors.suggestRateLimited') : t('errors.suggestFailed'))
    } finally {
      setSuggestLoading(false)
    }
  }, [showTemporaryError, t])

  const handleSubmit = useCallback(async () => {
    const guess = currentGuess.trim().toUpperCase()
    setSuggestPrompt(null)
    if (guess.length < MIN_GUESS_LENGTH) {
      if (guess.length > 0) showTemporaryError(t('errors.tooShort', { count: MIN_GUESS_LENGTH }))
      return
    }

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
      showTemporaryError(t('errors.notOnlyGivenLetters'))
      return
    }

    try {
      const response = await betuAPI.makeGuess(guess)

      setGuessCount((prevCount) => prevCount + 1)

      // The game ended for a reason other than scoring the final word (e.g. the
      // server-enforced timer expired). A successful all-words-found guess also reports
      // game_ended, but is handled below as a normal find so the "all found" celebration
      // effect can run.
      const isScoringGuess = response.valid && response.can_form && !response.already_guessed
      if (response.game_ended && !isScoringGuess) {
        // The only game-ending, non-scoring result is a server-side timer expiry
        // (ROADMAP 6.2: result is a code, not display text).
        endGame('expired')
        if (response.result === 'time_expired') showTemporaryError(t('errors.timeExpired'))
        return
      }

      if (response.valid && response.can_form) {
        if (!response.already_guessed) {
          if (!isTimeUp) {
            setFoundWords((prevWords) => [...prevWords, guess])
            setJustFoundWord(guess)

            // The board-clear celebration effect (above) reads this once foundWords
            // catches up to possibleWordsCount, on the same render.
            if (response.game_ended) {
              setCompletionBonus(response.completion_bonus ?? 0)
            }

            if (response.is_full_length || guess.length === scrambledLetters.filter((l) => l !== ' ').length) {
              fireExplosion()
            } else {
              fireConfetti()
            }
            // ROADMAP Batch 10 item 8: the arpeggio for clearing the board, the blip for
            // any other find.
            play(response.game_ended ? 'fullClear' : 'correct')
          } else {
            setIsScoreFlashing(true)
            setTimeout(() => setIsScoreFlashing(false), 500)
          }
          setCurrentGuess('')
        } else {
          showTemporaryError(t('errors.alreadyGuessed', { word: guess }))
          play('reject')
          setCurrentGuess('')
        }
      } else if (!response.valid) {
        // Not a known word (valid:false). Distinct from a real word that can't be built
        // from the board (valid:true, can_form:false) handled below.
        showTemporaryError(t('errors.notInDictionary', { word: guess }))
        play('reject')
        setSuggestPrompt(guess) // ROADMAP 4.2: maybe it's a real word the dictionary is missing
        setCurrentGuess('')
      } else {
        showTemporaryError(t('errors.notOnlyGivenLetters'))
        play('reject')
        setCurrentGuess('')
      }

      if (window.innerWidth >= 640) {
        document.getElementById('guess-input')?.focus()
      } else {
        document.getElementById('guess-input')?.blur()
      }
    } catch (err) {
      console.error('Error submitting guess:', err)
      // A 400 (game not active) or 404 (game expired/unknown) means the game is over on
      // the server — reflect that in the UI.
      const msg = err.message || err.toString() || ''
      if (msg.includes('400') || msg.includes('404')) {
        showTemporaryError(t('errors.gameEndedRetry'))
        setIsTimeUp(true)
      } else if (msg.includes('429')) {
        // Anti-cheat rate limit (ROADMAP 2.2) — not expected at human guessing speed.
        showTemporaryError(t('errors.rateLimited'))
      } else {
        showTemporaryError(t('errors.submitFailed'))
      }
      setCurrentGuess('')
      if (window.innerWidth >= 640) {
        document.getElementById('guess-input')?.focus()
      } else {
        document.getElementById('guess-input')?.blur()
      }
    }
  }, [currentGuess, scrambledLetters, fireExplosion, fireConfetti, isTimeUp, showTemporaryError, t, play, endGame])

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
      showTemporaryError(t('errors.scrambleFailed'))
    }
  }, [showTemporaryError, t])

  const handleGiveUp = useCallback(async () => {
    if (isTimeUp) return
    if (!window.confirm(t('giveUpHint.confirmGiveUp'))) return
    try {
      const result = await betuAPI.giveUp()
      endGame('given_up', { possibleWords: result.possible_words })
      // ROADMAP 6.2: giveUp() no longer sends a display string — target_word is already
      // in the body, which is all "the full word was X" needs.
      showTemporaryError(t('errors.revealed', { word: result.target_word }))
    } catch (err) {
      console.error('Error giving up:', err)
      showTemporaryError(t('errors.giveUpFailed'))
    }
  }, [isTimeUp, showTemporaryError, t, endGame])

  // Global keydown handler: letter keys append to the guess (unless a real input already
  // has focus), Backspace/Enter act on it regardless of focus.
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.id !== 'guess-input') {
        // ROADMAP 6.2: derived from the active game's wordlist (gameAlphabet), not a
        // hardcoded Hungarian-only whitelist.
        const acceptedKeys = gameAlphabet + ' '
        if (acceptedKeys.includes(e.key.toUpperCase())) {
          handleLetterClick(e.key.toUpperCase())
          e.preventDefault()
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
  }, [handleLetterClick, handleSubmit, gameAlphabet])

  const usedLetters = useMemo(() => {
    const used = Array(scrambledLetters.length).fill(false)
    const letters = currentGuess.split('')
    for (const letter of letters) {
      const index = scrambledLetters.findIndex((l, i) => l === letter && !used[i])
      if (index !== -1) used[index] = true
    }
    return used
  }, [currentGuess, scrambledLetters])

  return {
    // state
    currentGuess, foundWords, scrambledLetters, guessCount, isTimerActive, isTimeUp,
    timeLeft, isGuessShaking, guessErrorMsg, justFoundWord, isAnimatingLetters,
    currentAnimatingIndex, isScoreFlashing, preGame, targetLength, uiConfig, gameWordlist,
    scoreAtExpiry,
    gameEasyMode, isDailyGame, gameAlphabet, hintPenalty, hintLoading, hintMessage,
    reportedWords, suggestPrompt, suggestLoading, suggestThanks, possibleWordsCount,
    allPossibleWords, showRemainingWords, allPossibleWordsFound, totalScore, displayScore,
    usedLetters,
    setCurrentGuess, setShowRemainingWords,
    // actions
    beginFromStartResponse, enterPreGame, endGame,
    handleGuessChange, handleSubmit, handleLetterClick, handleScramble, handleGiveUp,
    handleUseHint, handleReportWord, handleSuggestWord,
  }
}
