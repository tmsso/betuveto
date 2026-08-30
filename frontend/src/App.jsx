import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { betuAPI } from './api/client'
import ReactCanvasConfetti from 'react-canvas-confetti'
import ConfirmationModal from './components/ConfirmationModal'
import OfflineNotice from './components/OfflineNotice'
import InstallPrompt from './components/InstallPrompt'
import SettingsPanel from './components/SettingsPanel'
import { useSound } from './components/useSound'
import { useTheme } from './components/useTheme'
import { definitionUrl } from './dictionary'

const canvasStyles = {
  position: 'fixed',
  pointerEvents: 'none',
  width: '100%',
  height: '100%',
  top: 0,
  left: 0,
  zIndex: 9999,
}

// Respect the OS "reduce motion" setting for the JS-driven confetti (the CSS
// animations are handled by a media query in index.css).
const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

// Adjustable constants
const TOP_SCORES_COUNT = 3;
const MIN_GUESS_LENGTH = 3;
const MIN_TARGET_LENGTH = 5;
const MAX_TARGET_LENGTH = 10;
const DEFAULT_TARGET_LENGTH = 7;
// Wordlist selector (ROADMAP 6.1) — which dictionary the target word is drawn from.
// Labels are endonyms (a language names itself the same way regardless of UI language,
// like most language pickers), so these aren't run through the i18n catalog.
const DEFAULT_WORDLIST = 'hu';
const WORDLISTS = [
  { code: 'hu', label: 'Magyar' },
  { code: 'en', label: 'English' },
];
// UI language selector (ROADMAP 6.2) — independent of the wordlist above (migrations/0010).
const UI_LANGUAGES = [
  { code: 'hu', label: 'Magyar' },
  { code: 'en', label: 'English' },
];
// Mirrors lib/words.ts's durationForLength (ROADMAP 2.3) — duplicated here the same way
// canFormWord/calculateScore already are in api/client.ts, since the frontend build
// doesn't share modules with the API's lib/. Only used before the first /start response
// arrives; the server's duration_seconds is always the source of truth after that.
const durationForLength = (length) => 120 + 15 * (length - MIN_TARGET_LENGTH);
const GAME_DURATION_SECONDS = durationForLength(DEFAULT_TARGET_LENGTH);
// Mirrors lib/hints.ts's HINT_COST — duplicated the same way durationForLength is above;
// used only to disable the hint button before it's obviously futile. The server is the
// real authority on cost and always floors the score at 0 regardless of this check.
const HINT_COST = 10;

function App() {
  const { t, i18n } = useTranslation()
  // ROADMAP Batch 10 item 8 — synthesised sound effects. Lifted here (not inside
  // <SoundToggle>) because `play` below has to read the same on/off value the toggle sets.
  const { soundEnabled, setSoundEnabled, play } = useSound()
  // ROADMAP Batch 10 item 7 — colour theme. Lifted here (rather than left inside
  // <ThemeToggle>, which now lives in the settings drawer) so useTheme's one-time
  // server-preference fetch still runs on app load, not only when the drawer is opened.
  const { theme, setTheme } = useTheme()

  // Accessibility (ROADMAP Batch 10): <html lang> drives screen-reader pronunciation and
  // was hardcoded "hu" in index.html since before the language selector (ROADMAP 6.2)
  // existed — never updated when a player switches UI language. Reacting to i18n.language
  // itself, not the selector's onChange, covers every way it can change (the selector, the
  // mount effect's saved-preference/browser-language resolution, any future path).
  useEffect(() => {
    document.documentElement.lang = i18n.language
  }, [i18n.language])

  // Game state
  const [currentGuess, setCurrentGuess] = useState('')
  const [foundWords, setFoundWords] = useState([])
  const [scrambledLetters, setScrambledLetters] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const [guessCount, setGuessCount] = useState(0)
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION_SECONDS)
  const [endsAt, setEndsAt] = useState(null)
  const [isTimerActive, setIsTimerActive] = useState(false)
  const [isTimeUp, setIsTimeUp] = useState(false)
  const [scoreAtExpiry, setScoreAtExpiry] = useState(0)
  // Time-remaining bonus for a full board clear, as computed by the server (ROADMAP
  // 3.2) — read from the winning guess's response, never recomputed from the client's
  // own countdown, so a slow network round-trip can't cost (or gain) bonus seconds.
  const [completionBonus, setCompletionBonus] = useState(0)

  // UI state
  const [isGuessShaking, setIsGuessShaking] = useState(false)
  const [guessErrorMsg, setGuessErrorMsg] = useState(null)
  const [justFoundWord, setJustFoundWord] = useState(null)
  const [isAnimatingLetters, setIsAnimatingLetters] = useState(false)
  const [currentAnimatingIndex, setCurrentAnimatingIndex] = useState(-1)
  const [isScoreFlashing, setIsScoreFlashing] = useState(false)
  // ROADMAP Batch 10 item 15 — the settings slide-over (language, theme, sound, length,
  // wordlist, easy mode, leaderboard, stats) opened by the header gear button.
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  // A single confirmation gate. `null` when nothing is pending; otherwise `{ message, run }`
  // and `run()` fires once the player confirms. Both the "Új játék" button and a
  // game-restarting selector change (length / wordlist / easy mode, item 15) funnel
  // through here so an in-progress game is never discarded without a prompt.
  const [pendingConfirm, setPendingConfirm] = useState(null)
  // Local top-3, kept only as an offline/error fallback now that scores are
  // server-side (ROADMAP 2.2) — the panel below prefers `serverScores` whenever it loads.
  const [highScores, setHighScores] = useState([])
  const [targetLength, setTargetLength] = useState(DEFAULT_TARGET_LENGTH)
  const [serverScores, setServerScores] = useState(null)
  const [serverScoresLoading, setServerScoresLoading] = useState(false)
  const [showHighScores, setShowHighScores] = useState(false)
  // Player stats (ROADMAP 3.3): server-side, aggregate only. Per-word history (which
  // words a player failed/solved) is not shown to players — product decision 2026-07-30,
  // this isn't an educational/practice game; word_stats now drives target selection
  // server-side instead (lib/word-stats.ts's pickPersonalizedWord).
  const [stats, setStats] = useState(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [showStats, setShowStats] = useState(false)
  // Hints (ROADMAP 3.1). Mirrors lib/hints.ts's HINT_COST the same way durationForLength
  // mirrors lib/words.ts — the frontend build doesn't share modules with the API's lib/.
  const [hintPenalty, setHintPenalty] = useState(0)
  const [hintLoading, setHintLoading] = useState(false)
  const [hintMessage, setHintMessage] = useState(null)
  // Word curation (ROADMAP 4.1): session-local, so a flagged chip shows disabled without
  // a round trip — the server itself is the source of truth for "already reported".
  const [reportedWords, setReportedWords] = useState(() => new Set())
  // Word curation (ROADMAP 4.2): the word from the most recently rejected guess, offered
  // back to the player as "maybe this is a real word?" — cleared on the next keystroke or
  // guess so it never lingers on a stale rejection.
  const [suggestPrompt, setSuggestPrompt] = useState(null)
  const [suggestLoading, setSuggestLoading] = useState(false)
  const [suggestThanks, setSuggestThanks] = useState(false)
  const [possibleWordsCount, setPossibleWordsCount] = useState(0)
  const [allPossibleWords, setAllPossibleWords] = useState([])
  const [showRemainingWords, setShowRemainingWords] = useState(false)
  const [allPossibleWordsFound, setAllPossibleWordsFound] = useState(false)

  // Word length option (ROADMAP 2.3). availableLengths defaults to the full 5-10 range
  // and is narrowed to whatever the server says has enough candidate words (>= 500);
  // selectedLength is the player's choice for the *next* game (mid-game changes don't
  // interrupt the current one — see handleLengthChange).
  const [selectedLength, setSelectedLength] = useState(DEFAULT_TARGET_LENGTH)
  const [availableLengths, setAvailableLengths] = useState(() =>
    Array.from(
      { length: MAX_TARGET_LENGTH - MIN_TARGET_LENGTH + 1 },
      (_, i) => MIN_TARGET_LENGTH + i,
    )
  )
  // Wordlist/language selector (ROADMAP 6.1) — which dictionary the target word is drawn
  // from. Not persisted server-side (unlike selectedLength): the roadmap only asks for a
  // start-screen selector here, no preference column for it. selectedWordlist is the
  // choice for the *next* game (mirrors selectedLength); gameWordlist is the just-started
  // game's actual wordlist, echoed back by the server (mirrors targetLength) — the
  // leaderboard panel below must key off the latter or it can show the wrong language's
  // scores for a few seconds after switching the selector but before starting a new game.
  const [selectedWordlist, setSelectedWordlist] = useState(DEFAULT_WORDLIST)
  const [gameWordlist, setGameWordlist] = useState(DEFAULT_WORDLIST)
  // Easy mode (ROADMAP Batch 10 "difficulty rating per word") — same "next game" vs
  // "active game" split as selectedWordlist/gameWordlist above, and likewise not
  // persisted server-side: it's a per-session toggle, not a saved preference. An "easy"
  // request can silently fall back to a normal pick server-side (lib/game.ts) if no word
  // yet qualifies, so gameEasyMode reflects the server's echoed actual outcome, not the
  // request.
  const [selectedEasyMode, setSelectedEasyMode] = useState(false)
  const [gameEasyMode, setGameEasyMode] = useState(false)
  // Which start-screen controls the admin has left visible (ROADMAP Batch 10 item 14),
  // echoed by game/start. `null` until the first response — treated as "show everything",
  // matching the pre-feature default and how an older deployment (no `ui` field) behaves.
  // A hidden control is also *forced* server-side, so the echoed target_length / wordlist
  // / difficulty already carry the pinned value; startNewGame syncs the selectors to it.
  const [uiConfig, setUiConfig] = useState(null)
  // Daily puzzle (ROADMAP Batch 10 item 1). isDailyGame = the *current* game is today's
  // shared puzzle (an ordinary game with daily_puzzle_id set server-side); dailyView is
  // the /api/v1/daily payload (puzzle meta + this player's streak/result + leaderboard),
  // refreshed when the settings panel opens and shortly after a daily game ends.
  const [isDailyGame, setIsDailyGame] = useState(false)
  const [dailyView, setDailyView] = useState(null)
  const [dailyLoading, setDailyLoading] = useState(false)
  // Accepted on-screen-keyboard letters for the active game's wordlist (ROADMAP 6.2) —
  // echoed back by game/start (lib/game.ts), replacing the old hardcoded Hungarian-only
  // whitelist. Seeded with hu's own alphabet so the very first render (before any
  // response has arrived) still matches the default wordlist.
  const [gameAlphabet, setGameAlphabet] = useState('ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÖŐÚÜŰ')

  // Confetti ref
  const confettiRef = useRef(null);
  const getInstance = useCallback((instance) => {
    confettiRef.current = instance;
  }, []);

  const fireConfetti = useCallback(() => {
    if (prefersReducedMotion()) return;
    confettiRef.current?.({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 }
    });
  }, []);

  const fireExplosion = useCallback(() => {
    if (prefersReducedMotion()) return;
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

  // Load high scores from localStorage on mount (kept only as an offline/error fallback
  // — failed words are server-side now, ROADMAP 3.3). Wrapped defensively: a single
  // corrupted value must not white-screen the app.
  useEffect(() => {
    try {
      setHighScores(JSON.parse(localStorage.getItem('betuveto_high_scores') || '[]'));
    } catch {
      setHighScores([]);
    }
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

  // Server high scores (ROADMAP 2.2): global top 10 + this player's best, for the
  // current board length. Refetched whenever a game ends, so a just-finished game's
  // score (and a fresh "your best") shows up without a page reload.
  const fetchServerScores = useCallback(async (length, wordlist) => {
    setServerScoresLoading(true);
    try {
      const result = await betuAPI.getTopScores(length, wordlist);
      setServerScores(result);
    } catch (err) {
      console.error('Error fetching high scores:', err);
      setServerScores(null);
    } finally {
      setServerScoresLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchServerScores(targetLength, gameWordlist);
  }, [targetLength, gameWordlist, isTimeUp, fetchServerScores]);

  // Player stats (ROADMAP 3.3): refetched whenever a game ends, same as the high-score
  // panel, so a just-finished game's outcome (and any newly-failed word) shows up
  // without a page reload.
  const fetchMyStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const result = await betuAPI.getMyStats();
      setStats(result);
    } catch (err) {
      console.error('Error fetching stats:', err);
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMyStats();
  }, [isTimeUp, fetchMyStats]);

  const totalScore = foundWords.reduce((sum, word) => sum + word.length * word.length, 0)
  const rawDisplayScore = allPossibleWordsFound ? scoreAtExpiry : (isTimeUp ? scoreAtExpiry : totalScore)
  // Hints (ROADMAP 3.1) deduct from the server's score; the client-side sum above never
  // knows about them, so the penalty is subtracted once, here, at the final display step
  // — floored at 0 the same way the server floors it (lib/game.ts's effectiveScore).
  const displayScore = Math.max(0, rawDisplayScore - hintPenalty)

  // End of game score tracking
  useEffect(() => {
    if (isTimeUp) {
      updateHighScores(scoreAtExpiry);
    }
  }, [isTimeUp, scoreAtExpiry, updateHighScores]);

  // Once the game has ended, fetch the full solution list for the reveal.
  // The server only serves it once it agrees the game is over; right at the
  // deadline (rounding or minor clock skew) it may still return 403, so retry
  // a few times before giving up.
  useEffect(() => {
    if (!isTimeUp) return;
    let cancelled = false;
    const MAX_ATTEMPTS = 6;
    const fetchReveal = async () => {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS && !cancelled; attempt++) {
        try {
          const words = await betuAPI.getPossibleWords();
          if (!cancelled) setAllPossibleWords(words);
          return;
        } catch (err) {
          if (attempt >= MAX_ATTEMPTS) {
            console.error('Error fetching possible words:', err);
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
    };
    fetchReveal();
    return () => { cancelled = true; };
  }, [isTimeUp]);

  // Main countdown timer. The server owns the deadline (`endsAt`, epoch
  // seconds); the client just renders the remaining time, so a slept/backgrounded
  // tab resyncs instead of drifting.
  useEffect(() => {
    if (!isTimerActive || isTimeUp || !endsAt) return;
    const tick = () => {
      // Ceil so the countdown only reaches 0 once the server deadline has
      // actually passed — rounding down would end the game up to half a second
      // early, before the server agrees it is over.
      const remaining = Math.max(0, Math.ceil(endsAt - Date.now() / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0) {
        setIsTimeUp(true);
        setScoreAtExpiry(totalScore);
        setIsTimerActive(false);
      }
    };
    tick();
    const interval = setInterval(tick, 500);
    return () => clearInterval(interval);
  }, [isTimerActive, isTimeUp, endsAt, totalScore]);

  // Check if all words found
  useEffect(() => {
    if (possibleWordsCount > 0 && foundWords.length === possibleWordsCount && !allPossibleWordsFound) {
      setAllPossibleWordsFound(true);
      setIsTimerActive(false);
      // completionBonus comes from the server's guess response (lib/game.ts), computed
      // from the actual time remaining when the last word was scored.
      setScoreAtExpiry(totalScore + completionBonus);
      setIsTimeUp(true);
    }
  }, [foundWords, possibleWordsCount, totalScore, completionBonus, allPossibleWordsFound]);

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

  const startNewGame = useCallback(async (length = DEFAULT_TARGET_LENGTH, wordlist = DEFAULT_WORDLIST, easyMode = false, daily = false) => {
    try {
      setIsLoading(true)
      setError(null)
      // A daily game (ROADMAP Batch 10 item 1) hits a different start endpoint but returns
      // the same body shape, so every setter below is unchanged — it just plays the shared
      // board. easyMode is ignored for the daily (always a normal pick).
      const response = daily
        ? await betuAPI.startDailyGame(wordlist, length)
        : await betuAPI.startGame(length, wordlist, easyMode ? 'easy' : 'normal')
      setIsDailyGame(daily)
      setScrambledLetters(response.scrambled_letters.split(' '))
      setTargetLength(response.target_length ?? DEFAULT_TARGET_LENGTH)
      setGameWordlist(response.wordlist ?? wordlist)
      setGameEasyMode(response.difficulty === 'easy')
      if (response.alphabet) setGameAlphabet(response.alphabet)
      // ROADMAP Batch 10 item 14: sync the "next game" selectors to whatever the server
      // actually used for any control the admin has hidden — the server forces it there
      // regardless, this just keeps the (hidden) selector and a later "Új játék" press in
      // step rather than sending a stale value the server would override anyway.
      const ui = response.ui ?? null
      setUiConfig(ui)
      if (ui && !ui.show_length_selector) setSelectedLength(response.target_length ?? DEFAULT_TARGET_LENGTH)
      if (ui && !ui.show_wordlist_selector) setSelectedWordlist(response.wordlist ?? DEFAULT_WORDLIST)
      if (ui && !ui.show_easy_mode) setSelectedEasyMode(false)
      setFoundWords([])
      setCurrentGuess('')
      setGuessCount(0)
      setJustFoundWord(null)
      setTimeLeft(response.duration_seconds ?? durationForLength(length))
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

      // The full solution list is no longer served while a game is active
      // (it would leak the answers). Only the count is known up front; the
      // list is fetched at game end for the reveal.
      setAllPossibleWords([])
      setPossibleWordsCount(response.possible_count)

      if (window.innerWidth >= 640) {
        document.getElementById('guess-input')?.focus();
      }
    } catch (err) {
      // A translation KEY, not translated text: startNewGame must stay a stable,
      // dependency-free useCallback (the mount effect below relies on that to avoid
      // restarting the game every time the UI language changes elsewhere) — the JSX
      // below translates this with the render's own (always-current) `t`.
      setError('errors.startGame')
      console.error('Error starting game:', err)
    } finally {
      setIsLoading(false)
    }
  }, [])

  // "Új játék" and every game-restarting selector (length / wordlist / easy mode) route
  // through here. If the player has real progress to lose, the restart waits behind the
  // confirmation modal; otherwise it runs straight away. ROADMAP Batch 10 item 15's
  // confirm-then-restart-now rule — it replaces the old silent "apply on the next new
  // game" deferral, which made a mid-game selector change look like it did nothing.
  const requestRestart = useCallback((run) => {
    if (foundWords.length > 0 && !isTimeUp) {
      setPendingConfirm({ message: t('confirmModal.message'), run })
    } else {
      run()
    }
  }, [foundWords.length, isTimeUp, t])

  const handleNewGameClick = useCallback(() => {
    requestRestart(() => startNewGame(selectedLength, selectedWordlist, selectedEasyMode))
  }, [requestRestart, startNewGame, selectedLength, selectedWordlist, selectedEasyMode])

  // Length selector (ROADMAP 2.3): a board's length is fixed for its game, so applying a
  // new one always starts a fresh game. The choice is persisted as the player's
  // preference (players.preferred_length) only once it's actually applied — a cancelled
  // confirm leaves both the game and the saved preference untouched.
  const handleLengthChange = useCallback((length) => {
    requestRestart(() => {
      setSelectedLength(length)
      betuAPI.setPreferredLength(length).catch((err) => {
        console.error('Error saving length preference:', err)
      })
      startNewGame(length, selectedWordlist, selectedEasyMode)
    })
  }, [requestRestart, startNewGame, selectedWordlist, selectedEasyMode])

  // Wordlist selector (ROADMAP 6.1): also re-fetches available lengths, since the
  // >=500-candidate threshold can admit a different length set per wordlist
  // (lib/game.ts's getAvailableLengths is wordlist-scoped) — falling back to the default
  // length if the current pick isn't offered for the new wordlist.
  const handleWordlistChange = useCallback((wordlist) => {
    requestRestart(async () => {
      setSelectedWordlist(wordlist)
      try {
        const lengths = await betuAPI.getAvailableLengths(wordlist)
        setAvailableLengths(lengths)
        const nextLength = lengths.includes(selectedLength) ? selectedLength : DEFAULT_TARGET_LENGTH
        setSelectedLength(nextLength)
        startNewGame(nextLength, wordlist, selectedEasyMode)
      } catch (err) {
        console.error('Error loading lengths for wordlist:', err)
      }
    })
  }, [requestRestart, startNewGame, selectedLength, selectedEasyMode])

  // Easy-mode toggle (ROADMAP Batch 10 "difficulty rating per word"): not a saved
  // preference, so no setPreferred* call — otherwise the same confirm-then-restart rule.
  const handleEasyModeChange = useCallback((easyMode) => {
    requestRestart(() => {
      setSelectedEasyMode(easyMode)
      startNewGame(selectedLength, selectedWordlist, easyMode)
    })
  }, [requestRestart, startNewGame, selectedLength, selectedWordlist])

  // Daily puzzle (ROADMAP Batch 10 item 1). The view (streak + leaderboard + this
  // player's result) is read-only and identity-optional; refreshed on settings-panel
  // open and shortly after a daily game ends.
  const refreshDailyView = useCallback(async () => {
    setDailyLoading(true)
    try {
      setDailyView(await betuAPI.getDaily(selectedWordlist, selectedLength))
    } catch (err) {
      console.error('Error loading daily puzzle:', err)
    } finally {
      setDailyLoading(false)
    }
  }, [selectedWordlist, selectedLength])

  // Starting the daily routes through the same confirm-before-restart funnel as the
  // length/wordlist selectors — losing real progress still prompts first.
  const handlePlayDaily = useCallback(() => {
    setIsSettingsOpen(false)
    requestRestart(() => startNewGame(selectedLength, selectedWordlist, false, true))
  }, [requestRestart, startNewGame, selectedLength, selectedWordlist])

  // Daily puzzle (ROADMAP Batch 10 item 1): keep the panel's streak/leaderboard current.
  // These live *after* refreshDailyView's declaration on purpose — a useEffect's
  // dependency array is evaluated during render, so referencing the callback above its
  // `const` would be a temporal-dead-zone access that throws on first paint.
  useEffect(() => {
    if (isSettingsOpen) refreshDailyView()
  }, [isSettingsOpen, refreshDailyView])

  // After a daily game reaches its terminal state the server has already graded the
  // result (finalizeWordStats runs on the same give-up / reveal call). The short delay
  // lets the reveal's getPossibleWords request — which is what triggers grading for a
  // pure timeout — land first.
  useEffect(() => {
    if (!isDailyGame || !isTimeUp) return
    const id = setTimeout(() => { refreshDailyView() }, 800)
    return () => clearTimeout(id)
  }, [isDailyGame, isTimeUp, refreshDailyView])

  // UI language selector (ROADMAP 6.2) — independent of the wordlist above; never
  // restarts a game, since it only changes how text renders, not any game state.
  const handleLanguageChange = useCallback((language) => {
    i18n.changeLanguage(language)
    betuAPI.setPreferredLanguage(language).catch((err) => {
      console.error('Error saving language preference:', err)
    })
  }, [i18n])

  // Hints (ROADMAP 3.1): reveals the first letter of a random unfound word and deducts
  // its cost. Disabled client-side once there's nothing left to hint at or the score
  // can't usefully absorb the cost — see hintPenalty/HINT_COST above for why the server
  // remains the real authority on both.
  // ROADMAP 6.2: lib/hints.ts's 400s now return a machine-readable code in `detail`
  // (game_not_active / no_hintable_words), which client.ts's getHint() throws as
  // err.message — map known codes to localised copy, falling back to a generic message
  // for anything else (a genuine network/server error, whose err.message is an English
  // "Failed to get a hint (500)"-style string, not one of these codes).
  const hintErrorMessage = useCallback((code) => {
    if (code === 'game_not_active') return t('errors.gameNotActive');
    if (code === 'no_hintable_words') return t('errors.noHintableWords');
    return t('errors.hintFailed');
  }, [t]);

  const handleUseHint = useCallback(async () => {
    if (isTimeUp || hintLoading) return;
    setHintLoading(true);
    try {
      const result = await betuAPI.useHint();
      setHintPenalty((prev) => prev + result.cost);
      setHintMessage(t('hintMessage', { length: result.word_length, letter: result.letter, cost: result.cost }));
      play('hint');
      setTimeout(() => setHintMessage(null), 5000);
    } catch (err) {
      console.error('Error getting a hint:', err);
      showTemporaryError(hintErrorMessage(err.message));
    } finally {
      setHintLoading(false);
    }
  }, [isTimeUp, hintLoading, showTemporaryError, hintErrorMessage, t, play]);

  // Word curation (ROADMAP 4.1): flag a found or missing word as wrong. Idempotent on
  // the server, so a double-click just comes back as already_reported — no need to guard
  // beyond disabling the button once this session has already reported it.
  const handleReportWord = useCallback(async (word) => {
    if (reportedWords.has(word)) return;
    try {
      await betuAPI.reportWord(word);
      setReportedWords((prev) => new Set(prev).add(word));
    } catch (err) {
      console.error('Error reporting word:', err);
      showTemporaryError(t('errors.reportFailed'));
    }
  }, [reportedWords, showTemporaryError, t]);

  // Word curation (ROADMAP 4.2): offer to submit a rejected guess as a possibly-real word
  // the dictionary is missing. already_present (word turned out to exist, or was already
  // suggested) and a genuinely new suggestion both read as the same "thanks" confirmation
  // to the player — the distinction only matters to the Batch 5 review queue, not to them.
  // A dedicated (non-error-styled) confirmation, not showTemporaryError's red shake box,
  // since "thanks, noted" is good news, not a mistake to flag.
  const handleSuggestWord = useCallback(async (word) => {
    setSuggestLoading(true);
    try {
      await betuAPI.suggestWord(word);
      setSuggestPrompt(null);
      setSuggestThanks(true);
      setTimeout(() => setSuggestThanks(false), 2500);
    } catch (err) {
      console.error('Error suggesting word:', err);
      showTemporaryError(err.message?.includes('429') ? t('errors.suggestRateLimited') : t('errors.suggestFailed'));
    } finally {
      setSuggestLoading(false);
    }
  }, [showTemporaryError, t]);

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

      setGuessCount((prevCount) => prevCount + 1);

      // The game ended for a reason other than scoring the final word
      // (e.g. the server-enforced timer expired). A successful all-words-found
      // guess also reports game_ended, but is handled below as a normal find so
      // the "all found" celebration effect can run.
      const isScoringGuess = response.valid && response.can_form && !response.already_guessed
      if (response.game_ended && !isScoringGuess) {
        setIsTimeUp(true)
        setScoreAtExpiry(totalScore)
        setIsTimerActive(false)
        // The only game-ending, non-scoring result is a server-side timer expiry
        // (ROADMAP 6.2: result is a code, not display text — see lib/game.ts's guess()).
        if (response.result === 'time_expired') {
          showTemporaryError(t('errors.timeExpired'))
        }
        return
      }

      if (response.valid && response.can_form) {
        if (!response.already_guessed) {
          if (!isTimeUp) {
            setFoundWords((prevWords) => [...prevWords, guess])
            setJustFoundWord(guess)

            // The board-clear celebration effect (below) reads this once foundWords
            // catches up to possibleWordsCount, on the same render.
            if (response.game_ended) {
              setCompletionBonus(response.completion_bonus ?? 0)
            }

            if (response.is_full_length || guess.length === scrambledLetters.filter(l => l !== ' ').length) {
              fireExplosion()
            } else {
              fireConfetti()
            }
            // ROADMAP Batch 10 item 8: the arpeggio for clearing the board, the blip
            // for any other find. game_ended in this (found-a-word) branch means the
            // last word just completed the board.
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
        // Not a known word (valid:false). Distinct from a real word that can't
        // be built from the board (valid:true, can_form:false) handled below.
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
      // A 400 (game not active) or 404 (game expired/unknown) means the game
      // is over on the server — reflect that in the UI.
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
  }, [currentGuess, scrambledLetters, fireExplosion, fireConfetti, isTimeUp, totalScore, showTemporaryError, t, play])

  // On mount only: load which lengths are worth offering and the player's saved
  // preferences (ROADMAP 2.3 / 6.2, all no-ops for a first-ever visitor with no cookie
  // yet), then start the first game.
  //
  // Deliberately a [] dependency array (ROADMAP Batch 10 item 15 bug fix). This used to
  // list `[startNewGame, i18n]`: `startNewGame` is a stable [] useCallback, and the
  // `i18n` from useTranslation() *used to be* the stable i18next singleton — but
  // react-i18next 17 wraps it in a fresh object (Object.create) on every `languageChanged`
  // event, so `handleLanguageChange` → `i18n.changeLanguage()` was giving this effect a
  // new `i18n` identity, re-running it, and silently restarting the player's in-progress
  // game (and resetting it to the default wordlist). This effect must run exactly once;
  // `let cancelled` still handles StrictMode's mount/unmount/mount double-invoke correctly.
  useEffect(() => {
    let cancelled = false
    const init = async () => {
      let initialLength = DEFAULT_TARGET_LENGTH
      try {
        const [lengths, preferred, preferredLanguage] = await Promise.all([
          betuAPI.getAvailableLengths(),
          betuAPI.getPreferredLength(),
          betuAPI.getPreferredLanguage(),
        ])
        if (cancelled) return
        setAvailableLengths(lengths)
        if (preferred && lengths.includes(preferred)) initialLength = preferred

        // UI language (ROADMAP 6.2): player preference first, then the browser's own
        // language, then i18n's configured default (hu) — same fallback order
        // preferred_length already uses (server preference, else a sensible default).
        const supportedCodes = UI_LANGUAGES.map((l) => l.code)
        const browserLanguage = navigator.language?.slice(0, 2)
        const resolvedLanguage =
          (preferredLanguage && supportedCodes.includes(preferredLanguage) && preferredLanguage) ||
          (browserLanguage && supportedCodes.includes(browserLanguage) && browserLanguage) ||
          i18n.language
        if (resolvedLanguage !== i18n.language) i18n.changeLanguage(resolvedLanguage)
      } catch (err) {
        console.error('Error loading length/language preferences:', err)
      }
      if (cancelled) return
      setSelectedLength(initialLength)
      startNewGame(initialLength)
    }
    init()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])


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
      setAllPossibleWords(result.possible_words)
      setScoreAtExpiry(totalScore)
      setIsTimerActive(false)
      setIsTimeUp(true)
      // ROADMAP 6.2: giveUp() no longer sends a display string — target_word is already
      // in the body, which is all "the full word was X" needs.
      showTemporaryError(t('errors.revealed', { word: result.target_word }))
    } catch (err) {
      console.error('Error giving up:', err)
      showTemporaryError(t('errors.giveUpFailed'))
    }
  }, [isTimeUp, totalScore, showTemporaryError, t])

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.id !== 'guess-input') {
        // ROADMAP 6.2: derived from the active game's wordlist (gameAlphabet), not a
        // hardcoded Hungarian-only whitelist — this only gated the "letter key while not
        // focused in the input" shortcut path, never the input field itself.
        const acceptedKeys = gameAlphabet + ' '
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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-game-paper flex items-center justify-center font-sans">
        <OfflineNotice />
        <InstallPrompt />
        <div className="text-center">
          <div className="animate-pulse text-4xl text-game-secondary mb-4">{t('loading.screen')}</div>
          <p className="text-game-muted">{t('loading.startingGame')}</p>
        </div>
      </div>
    )
  }

  if (error && !isLoading) {
    return (
        <div className="min-h-screen flex items-center justify-center bg-game-paper p-4 font-sans">
            <OfflineNotice />
            <InstallPrompt />
            <div className="bg-red-100 dark:bg-red-950/40 border border-red-400 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-3 rounded-lg text-center max-w-md mx-auto">
                <strong className="font-bold">{t('errorScreen.title')}</strong>
                <span className="block sm:inline"> {t(error)}</span>
                <div className="mt-4">
                    <button
                        onClick={startNewGame}
                        className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
                    >
                        {t('errorScreen.retry')}
                    </button>
                </div>
            </div>
        </div>
    );
  }

  return (
    <div className="min-h-screen bg-game-paper p-4 flex flex-col items-center justify-center font-sans text-game-primary">
      <OfflineNotice />
      <InstallPrompt />
      <ReactCanvasConfetti ref={getInstance} style={canvasStyles} />
      
      {/* Header */}
      <div className="text-center mb-8 w-full flex flex-col items-center">
        <h1 className="text-5xl font-extrabold text-game-primary mb-2 font-display leading-tight">{t('app.title')}</h1>
        {/* ROADMAP Batch 10 item 15 — every non-core control (language, theme, sound,
            length, wordlist, easy mode, leaderboard, stats) now lives behind this one
            gear button, in <SettingsPanel>, leaving the board / input / score / timer /
            actions as the default view. */}
        <button
          type="button"
          onClick={() => setIsSettingsOpen(true)}
          aria-label={t('settings.open')}
          title={t('settings.open')}
          className="mt-1 inline-flex items-center gap-1.5 text-xs border border-game-border rounded-lg px-3 py-1 text-game-primary bg-game-surface hover:bg-gray-100 dark:hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-game-secondary"
        >
          <span aria-hidden="true">⚙️</span>
          <span>{t('settings.open')}</span>
        </button>
      </div>

      <div className="bg-game-surface rounded-xl shadow-2xl p-6 sm:p-8 max-w-xl w-full border-4 border-game-border relative overflow-hidden">
        {/* Easy-mode indicator (ROADMAP Batch 10) — the checkbox alone can't show a
            silent server-side fallback to a normal pick (lib/game.ts: no word yet
            qualifies), so this reflects gameEasyMode, the server's echoed actual outcome,
            not the request. */}
        {gameEasyMode && (
            <div className="absolute top-0 left-0 p-2 bg-green-100 dark:bg-green-950/40 text-green-800 dark:text-green-300 text-xs font-bold rounded-br-lg border-r-2 border-b-2 border-green-200 dark:border-green-900">
                🌱 {t('easyModeBadge')}
            </div>
        )}

        {/* Daily-puzzle indicator (ROADMAP Batch 10 item 1) — the current game is today's
            shared board; the result is graded once, at its terminal transition. */}
        {isDailyGame && (
            <div className="absolute top-0 right-0 p-2 bg-blue-100 dark:bg-blue-950/40 text-blue-800 dark:text-blue-300 text-xs font-bold rounded-bl-lg border-l-2 border-b-2 border-blue-200 dark:border-blue-900">
                🗓️ {t('daily.badge')}
            </div>
        )}

        {/* Length / wordlist / easy-mode selectors moved into <SettingsPanel> (ROADMAP
            Batch 10 item 15). The 🌱 indicator above stays here — it reports the server's
            actual pick, not a control. */}

        {/* Score and New Game Button */}
        <div className="flex justify-between items-center mb-6">
          <div className="text-left">
            <div
              className={`text-3xl font-bold ${isScoreFlashing ? 'animate-pulse text-red-600 dark:text-red-400' : 'text-game-primary'}`}
              aria-live="polite"
              aria-label={t('score.ariaLabel', { score: displayScore })}
            >
              🏆 {displayScore} <span className="hidden sm:inline">{t('score.pointsSuffix')}</span>
            </div>
            <div className={`text-md text-game-muted transition-all duration-1000 ${allPossibleWordsFound ? 'animate-pulse scale-110 font-bold text-game-success' : ''}`}>
              {t('score.progress', { found: foundWords.length, total: possibleWordsCount, guesses: guessCount })} {allPossibleWordsFound && '✨'}
            </div>
          </div>
          <div className="flex items-center justify-center space-x-2">
            <div
              className={`text-2xl font-bold ${timeLeft < 60 ? 'text-red-600 dark:text-red-400 animate-pulse' : 'text-game-primary'}`}
              role="timer"
              aria-label={t('score.timerAriaLabel', { time: `${Math.floor(timeLeft / 60)}:${(timeLeft % 60).toString().padStart(2, '0')}` })}
            >
              ⏳ {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
            </div>
          </div>
        </div>

        {/* Leaderboard toggle + panel moved into <SettingsPanel> (ROADMAP Batch 10 item 15). */}

        {/* Scrambled letters */}
        <div className="mb-8 text-center">
          <div className="flex flex-wrap gap-2 sm:gap-3 justify-center max-w-[280px] sm:max-w-none mx-auto" role="group" aria-label={t('board.ariaLabel')}>
            {scrambledLetters.map((letter, index) => (
              <button
                key={index}
                onClick={() => handleLetterClick(letter)}
                aria-label={t('board.letterAriaLabel', { letter })}
                className={`w-12 h-12 sm:w-14 sm:h-14 rounded-lg flex items-center justify-center text-2xl sm:text-3xl font-extrabold shadow-md transition-all transform active:scale-90 focus:outline-none focus:ring-2 focus:ring-opacity-50
                ${currentAnimatingIndex === index 
                  ? 'animate-pulse ring-4 ring-yellow-400 scale-125 z-10' 
                  : usedLetters[index] 
                    ? 'bg-gray-300 dark:bg-slate-600 border-gray-400 dark:border-slate-500 text-gray-700 dark:text-slate-200' 
                    : 'bg-blue-100 dark:bg-blue-500/20 border-2 border-blue-300 dark:border-blue-400/50 text-blue-800 dark:text-blue-200 hover:bg-blue-200 dark:hover:bg-blue-500/30 hover:-translate-y-1 hover:scale-110 focus:ring-blue-500'}`}
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
                {/* role="alert" (ROADMAP Batch 10 accessibility pass): an implicit
                    assertive live region, so a screen reader announces a rejected guess
                    even though nothing else on the page changes when it appears. */}
                <span role="alert" className="bg-red-500 text-white text-sm font-bold px-3 py-1 rounded shadow-lg animate-fade-out-up">
                  {guessErrorMsg}
                </span>
             </div>
          )}

          <div className="relative">
            <input
              id="guess-input"
              type="text"
              aria-label={t('guessInput.ariaLabel')}
              value={currentGuess}
              onChange={(e) => {
                const val = e.target.value.toUpperCase();
                // Limit to 15 characters
                if (val.length <= 15) {
                  setCurrentGuess(val);
                  setSuggestPrompt(null);
                }
              }}
              className={
                `w-full min-h-[70px] bg-game-paper border-4 rounded-lg p-5 font-extrabold text-game-primary text-center uppercase 
                shadow-inner focus:outline-none focus:ring-4 focus:ring-game-secondary 
                ${isGuessShaking ? 'animate-shake border-game-error bg-red-50 dark:bg-red-950/40 ' : 'border-game-border'}
                ${currentGuess.length > 10 ? 'text-2xl sm:text-3xl' : 'text-4xl'}`
              }
              placeholder={t('guessInput.placeholder')}
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
              autoFocus // Auto-focus on load
            />
            {currentGuess && (
              <button
                onClick={() => setCurrentGuess('')}
                aria-label={t('guessInput.clearAriaLabel')}
                className="absolute right-3 top-1/2 -translate-y-1/2 bg-gray-200 dark:bg-slate-700 hover:bg-gray-300 dark:hover:bg-slate-600 rounded-full w-10 h-10 flex items-center justify-center text-gray-700 dark:text-slate-200 text-xl"
              >
                ✖️
              </button>
            )}
          </div>

          {/* Word curation (ROADMAP 4.2): offer to submit a rejected guess as a word the
              dictionary might be missing. Replaced by a brief thanks confirmation on submit. */}
          {(suggestPrompt || suggestThanks) && (
            <div className="absolute -bottom-7 left-1/2 transform -translate-x-1/2 z-10 w-full text-center">
              <span role="status" aria-live="polite" className="text-xs sm:text-sm text-game-primary/70">
                {suggestThanks ? (
                  t('suggestion.thanks')
                ) : (
                  <>
                    {t('suggestion.prompt')}{' '}
                    <button
                      onClick={() => handleSuggestWord(suggestPrompt)}
                      disabled={suggestLoading}
                      className="underline font-bold hover:text-game-primary disabled:opacity-50"
                    >
                      {t('suggestion.submit')}
                    </button>
                  </>
                )}
              </span>
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="mb-6 flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2 sm:gap-3">
            <button
              onClick={handleNewGameClick}
              aria-label={t('actions.newGameAriaLabel')}
              className="h-12 sm:h-14 w-28 sm:w-32 max-[420px]:w-12 rounded-full shadow-lg bg-game-secondary text-white text-sm sm:text-base font-semibold hover:bg-blue-600 transition-all transform hover:scale-105 active:scale-95 whitespace-nowrap inline-flex items-center justify-center gap-2"
            >
              <span>🎲</span>
              <span className="max-[420px]:hidden">{t('actions.newGame')}</span>
            </button>
            <button
              onClick={handleScramble}
              className="h-12 sm:h-14 w-28 sm:w-32 max-[420px]:w-12 rounded-full shadow-lg bg-game-surface border-2 border-game-border text-game-primary text-sm sm:text-base font-semibold hover:bg-gray-100 dark:hover:bg-slate-700 transition-all transform hover:scale-105 active:scale-95 whitespace-nowrap inline-flex items-center justify-center gap-2"
              aria-label={t('actions.scrambleAriaLabel')}
              title={t('actions.scrambleAriaLabel')}
            >
              <span>🔀</span>
              <span className="max-[420px]:hidden">{t('actions.scramble')}</span>
            </button>
          </div>

          <button
            onClick={handleSubmit}
            aria-label={t('actions.submitAriaLabel')}
            disabled={!currentGuess.trim()}
            className={`h-12 sm:h-14 w-28 sm:w-32 max-[360px]:w-12 rounded-full shadow-lg text-sm sm:text-base font-semibold transition-all transform whitespace-nowrap inline-flex items-center justify-center gap-2
              ${currentGuess.trim()
                ? 'bg-game-success text-white hover:bg-green-600 hover:scale-105 active:scale-95'
                : 'bg-gray-300 dark:bg-slate-700 cursor-not-allowed text-game-muted'
              }`}
          >
            <span>✅</span>
            <span className="max-[360px]:hidden">{t('actions.submit')}</span>
          </button>
        </div>

        {/* Give up + Hint (ROADMAP 3.1) */}
        {!isTimeUp && (
          <div className="mb-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <button
              onClick={handleGiveUp}
              className="text-xs text-game-muted underline hover:text-red-600"
            >
              {t('giveUpHint.giveUp')}
            </button>
            <button
              onClick={handleUseHint}
              disabled={hintLoading || foundWords.length >= possibleWordsCount}
              title={t('giveUpHint.hintTitle', { cost: HINT_COST })}
              className="text-xs text-game-secondary underline hover:text-blue-700 dark:hover:text-blue-300 disabled:text-gray-300 dark:disabled:text-slate-600 disabled:no-underline disabled:cursor-not-allowed"
            >
              {t('giveUpHint.hint', { cost: HINT_COST })}
            </button>
          </div>
        )}

        {hintMessage && (
          <div role="status" aria-live="polite" className="mb-4 text-center text-sm font-semibold text-yellow-700 dark:text-yellow-300 bg-yellow-50 dark:bg-yellow-950/40 border border-yellow-200 dark:border-yellow-900 rounded-lg px-3 py-2">
            {hintMessage}
          </div>
        )}

        {/* Stats toggle + panel moved into <SettingsPanel> (ROADMAP Batch 10 item 15). */}

        {/* Found words display (Alphabetical Sort) */}
        {foundWords.length > 0 && (
          <div className="mt-8 border-t-2 border-game-border pt-6">
            <h3 className="text-2xl font-bold text-game-primary mb-4 text-center">{t('foundWords.header')}</h3>
            <div className="flex flex-wrap gap-3 justify-center">
              {[...foundWords].sort((a, b) => a.localeCompare(b, gameWordlist)).map((word, index) => (
                <span
                  key={index}
                  className={`inline-flex items-center gap-1.5 bg-green-100 dark:bg-green-500/15 text-green-800 dark:text-green-300 px-4 py-2 rounded-full text-md font-semibold shadow-sm animate-bounce-in transition-all duration-500
                    ${justFoundWord === word ? 'ring-4 ring-yellow-400 bg-yellow-100 dark:bg-yellow-500/20 scale-110' : ''}`}
                >
                  {word} ({t('foundWords.points', { points: word.length * word.length })})
                  {isTimeUp && definitionUrl(word, gameWordlist) && (
                    <a
                      href={definitionUrl(word, gameWordlist)}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={t('dictionary.lookupAriaLabel', { word })}
                      title={t('dictionary.lookupTitle')}
                      className="text-xs leading-none opacity-60 hover:opacity-100 hover:text-blue-700 dark:hover:text-blue-300"
                    >
                      📖
                    </a>
                  )}
                  <button
                    onClick={() => handleReportWord(word)}
                    disabled={reportedWords.has(word)}
                    aria-label={t('foundWords.reportAriaLabel', { word })}
                    title={t('foundWords.reportTitle')}
                    className={`text-xs leading-none ${reportedWords.has(word) ? 'opacity-30 cursor-default' : 'opacity-60 hover:opacity-100 hover:text-red-700'}`}
                  >
                    ⚑
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Remaining Words Dropdown (Only after game end) */}
        {isTimeUp && allPossibleWords.length > foundWords.length && (
            <div className="mt-6 pt-4 border-t border-dashed border-gray-200 dark:border-slate-700">
                <button
                  onClick={() => setShowRemainingWords(!showRemainingWords)}
                  className="w-full text-center text-sm font-bold text-game-secondary hover:text-blue-700 dark:hover:text-blue-300 flex items-center justify-center gap-2"
                >
                  {showRemainingWords
                    ? t('remainingWords.hide')
                    : t('remainingWords.show', { count: allPossibleWords.length - foundWords.length })}
                </button>

                {showRemainingWords && (
                    <div className="mt-4 flex flex-wrap gap-2 justify-center">
                        {allPossibleWords
                            .filter(word => !foundWords.includes(word))
                            .sort((a, b) => a.localeCompare(b, gameWordlist))
                            .map((word, index) => (
                                <span key={index} className="inline-flex items-center gap-1 text-xs bg-gray-100 dark:bg-slate-800 text-game-muted px-2 py-1 rounded border border-gray-200 dark:border-slate-700">
                                    {word}
                                    {definitionUrl(word, gameWordlist) && (
                                      <a
                                        href={definitionUrl(word, gameWordlist)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        aria-label={t('dictionary.lookupAriaLabel', { word })}
                                        title={t('dictionary.lookupTitle')}
                                        className="leading-none opacity-60 hover:opacity-100 hover:text-blue-700 dark:hover:text-blue-300"
                                      >
                                        📖
                                      </a>
                                    )}
                                    <button
                                        onClick={() => handleReportWord(word)}
                                        disabled={reportedWords.has(word)}
                                        aria-label={t('foundWords.reportAriaLabel', { word })}
                                        title={t('foundWords.reportTitle')}
                                        className={`leading-none ${reportedWords.has(word) ? 'opacity-30 cursor-default' : 'opacity-60 hover:opacity-100 hover:text-red-700'}`}
                                    >
                                        ⚑
                                    </button>
                                </span>
                            ))
                        }
                    </div>
                )}
            </div>
        )}

        {/* Temporary info/error messages. In practice unreachable: the early-return
            error screen above already intercepts every case that sets `error`, since
            startNewGame's catch always pairs setError with setIsLoading(false) in the
            same batch — kept only so a `error` state introduced by future code has
            somewhere sane to render, rather than silently doing nothing. */}
        {error && (
          <div className="mt-6 p-4 rounded-lg text-center font-semibold bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300">
            {t(error)}
          </div>
        )}
      </div>

      <SettingsPanel
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        languages={UI_LANGUAGES}
        language={i18n.language}
        onLanguageChange={handleLanguageChange}
        theme={theme}
        onThemeChange={setTheme}
        soundEnabled={soundEnabled}
        onSoundToggle={setSoundEnabled}
        wordlists={WORDLISTS}
        selectedWordlist={selectedWordlist}
        onWordlistChange={handleWordlistChange}
        availableLengths={availableLengths}
        selectedLength={selectedLength}
        onLengthChange={handleLengthChange}
        selectedEasyMode={selectedEasyMode}
        onEasyModeChange={handleEasyModeChange}
        controlsDisabled={isLoading}
        uiConfig={uiConfig}
        showHighScores={showHighScores}
        onToggleHighScores={() => setShowHighScores((v) => !v)}
        serverScores={serverScores}
        serverScoresLoading={serverScoresLoading}
        highScores={highScores}
        targetLength={targetLength}
        showStats={showStats}
        onToggleStats={() => setShowStats((v) => !v)}
        stats={stats}
        statsLoading={statsLoading}
        daily={dailyView}
        dailyLoading={dailyLoading}
        isDailyGame={isDailyGame}
        onPlayDaily={handlePlayDaily}
      />

      <ConfirmationModal
        isOpen={pendingConfirm !== null}
        onClose={() => setPendingConfirm(null)}
        onConfirm={() => pendingConfirm?.run()}
        message={pendingConfirm?.message ?? ''}
      />
    </div>
  )
}

export default App
