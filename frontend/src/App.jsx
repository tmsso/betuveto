import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { betuAPI } from './api/client'
import ReactCanvasConfetti from 'react-canvas-confetti'
import ConfirmationModal from './components/ConfirmationModal'
import OfflineNotice from './components/OfflineNotice'
import InstallPrompt from './components/InstallPrompt'
import SettingsPanel from './components/SettingsPanel'
import HelpPanel from './components/HelpPanel'
import RoomLobby from './components/RoomLobby'
import RoomInvite from './components/RoomInvite'
import RoomStrip from './components/RoomStrip'
import RoomResults from './components/RoomResults'
import { useRoom } from './components/useRoom'
import Board from './components/Board'
import GuessInput from './components/GuessInput'
import Timer from './components/Timer'
import Scoreboard from './components/Scoreboard'
import { useSound } from './components/useSound'
import { useTheme } from './components/useTheme'
import { useDisplayName } from './components/useDisplayName'
import { useGame } from './components/useGame'
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
// ROADMAP 7.2.5 — an invite link is `/?room=CODE`. Read once on load; the param is removed
// from the address bar once the invite has been accepted or dismissed.
function readInviteCode() {
  const raw = new URLSearchParams(window.location.search).get('room')
  const code = raw?.trim().toUpperCase()
  return code && /^[A-Z0-9]{6}$/.test(code) ? code : null
}

function clearInviteParam() {
  const url = new URL(window.location.href)
  url.searchParams.delete('room')
  window.history.replaceState(null, '', url.pathname + url.search + url.hash)
}

// UI language selector (ROADMAP 6.2) — independent of the wordlist above (migrations/0010).
const UI_LANGUAGES = [
  { code: 'hu', label: 'Magyar' },
  { code: 'en', label: 'English' },
];

function App() {
  const { t, i18n } = useTranslation()
  // ROADMAP Batch 10 item 8 — synthesised sound effects. Lifted here (not inside
  // <SoundToggle>) because `play` below has to read the same on/off value the toggle sets.
  const { soundEnabled, setSoundEnabled, play } = useSound()
  // ROADMAP Batch 10 item 7 — colour theme. Lifted here (rather than left inside
  // <ThemeToggle>, which now lives in the settings drawer) so useTheme's one-time
  // server-preference fetch still runs on app load, not only when the drawer is opened.
  const { theme, setTheme } = useTheme()
  // ROADMAP 7.2.0 — player-set display name, shown on the leaderboards instead of
  // "Névtelen játékos". Loaded here (not lazily on drawer-open) to match useTheme/useSound.
  const { displayName, setDisplayName } = useDisplayName()

  // Accessibility (ROADMAP Batch 10): <html lang> drives screen-reader pronunciation and
  // was hardcoded "hu" in index.html since before the language selector (ROADMAP 6.2)
  // existed — never updated when a player switches UI language. Reacting to i18n.language
  // itself, not the selector's onChange, covers every way it can change (the selector, the
  // mount effect's saved-preference/browser-language resolution, any future path).
  useEffect(() => {
    document.documentElement.lang = i18n.language
  }, [i18n.language])

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

  // ROADMAP 7.2.1 — the single-game state machine (board, guess, timer, hints, word
  // curation, ...). See useGame.js's own top comment for exactly what stayed here instead
  // and why (the startNewGame wrapper below, "next game" selectors, the confirmation-modal
  // gate, and the leaderboard/stats/achievements/daily panels).
  // Multiplayer rooms (ROADMAP 7.2.5): the room this tab follows + its polled snapshot.
  // Declared before useGame so a room-ending guess can refresh it at once.
  const rooms = useRoom()
  const game = useGame({ t, play, fireConfetti, fireExplosion, onRoomFinished: rooms.refresh })
  const {
    currentGuess, foundWords, scrambledLetters, guessCount, isTimeUp, timeLeft,
    isGuessShaking, guessErrorMsg, justFoundWord, currentAnimatingIndex, isScoreFlashing,
    preGame, targetLength, uiConfig, gameWordlist, gameEasyMode, isDailyGame,
    hintLoading, hintMessage, reportedWords, suggestPrompt, suggestLoading, suggestThanks,
    possibleWordsCount, allPossibleWords, showRemainingWords, allPossibleWordsFound,
    displayScore, usedLetters, scoreAtExpiry,
    setCurrentGuess, setShowRemainingWords, setUiConfig,
    beginFromStartResponse, enterPreGame,
    handleGuessChange, handleSubmit, handleLetterClick, handleScramble, handleGiveUp,
    handleUseHint, handleReportWord, handleSuggestWord,
    hintCost, minWordLength, isRoomGame, endGame, applyRevealWords,
  } = game

  // Game-start orchestration (which endpoint to hit, syncing the "next game" selectors to
  // a server-forced value) — kept out of useGame.js because a room start (7.2.6) will call
  // beginFromStartResponse directly with a room snapshot, bypassing this wrapper entirely.
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)

  // UI state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isHelpOpen, setIsHelpOpen] = useState(false) // ROADMAP 12.5 how-to-play
  const [inviteCode, setInviteCode] = useState(readInviteCode)
  // A single confirmation gate. `null` when nothing is pending; otherwise `{ message, run }`
  // and `run()` fires once the player confirms. Both the "Új játék" button and a
  // game-restarting selector change (length / wordlist / easy mode, item 15) funnel
  // through here so an in-progress game is never discarded without a prompt.
  // Optional `title` / `confirmLabel` override the modal's "new game?" defaults (give-up).
  const [pendingConfirm, setPendingConfirm] = useState(null)
  // Local top-3, kept only as an offline/error fallback now that scores are
  // server-side (ROADMAP 2.2) — the panel below prefers `serverScores` whenever it loads.
  const [highScores, setHighScores] = useState([])
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
  // Achievements (ROADMAP Batch 10 item 10). `achievements` is the full catalog (locked
  // entries included); `achievementToast` holds keys newly unlocked at the last game end,
  // shown briefly then cleared. `achievementBaselineRef` guards against toasting a
  // returning player's whole earned set on their first game-end before the mount fetch
  // has established what they already had.
  const [achievements, setAchievements] = useState(null)
  const [achievementsLoading, setAchievementsLoading] = useState(false)
  const [achievementToast, setAchievementToast] = useState([])
  const achievementUnlockedRef = useRef(new Set())
  const achievementBaselineRef = useRef(false)

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
  // choice for the *next* game (mirrors selectedLength); the just-started game's actual
  // wordlist (gameWordlist, from useGame) is what the leaderboard panel must key off, or
  // it can show the wrong language's scores for a few seconds after switching the
  // selector but before starting a new game.
  const [selectedWordlist, setSelectedWordlist] = useState(DEFAULT_WORDLIST)
  // Easy mode (ROADMAP Batch 10 "difficulty rating per word") — same "next game" vs
  // "active game" split as selectedWordlist/gameWordlist above, and likewise not
  // persisted server-side: it's a per-session toggle, not a saved preference.
  const [selectedEasyMode, setSelectedEasyMode] = useState(false)
  // Daily puzzle (ROADMAP Batch 10 item 1). dailyView is the /api/v1/daily payload
  // (puzzle meta + this player's streak/result + leaderboard), refreshed when the
  // settings panel opens and shortly after a daily game ends.
  const [dailyView, setDailyView] = useState(null)
  const [dailyLoading, setDailyLoading] = useState(false)

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

  // Achievements (ROADMAP Batch 10 item 10). The server evaluates + persists them at a
  // game's terminal transition (lib/game.ts finalizeWordStats); the client just re-reads
  // the catalog and diffs it. `toastNew` compares the fresh unlocked set against the last
  // one we saw and surfaces anything new — skipped until the mount fetch has run once
  // (achievementBaselineRef), so a returning player doesn't get their whole history
  // toasted at the first game-end.
  const fetchMyAchievements = useCallback(async ({ toastNew = false } = {}) => {
    setAchievementsLoading(true);
    try {
      const result = await betuAPI.getMyAchievements();
      const unlocked = new Set(
        result.achievements.filter((a) => a.unlocked_at).map((a) => a.key),
      );
      if (toastNew && achievementBaselineRef.current) {
        const fresh = [...unlocked].filter((k) => !achievementUnlockedRef.current.has(k));
        if (fresh.length > 0) setAchievementToast(fresh);
      }
      achievementUnlockedRef.current = unlocked;
      achievementBaselineRef.current = true;
      setAchievements(result);
    } catch (err) {
      console.error('Error fetching achievements:', err);
      setAchievements(null);
    } finally {
      setAchievementsLoading(false);
    }
  }, []);

  // Baseline on mount.
  useEffect(() => {
    fetchMyAchievements();
  }, [fetchMyAchievements]);

  // On game end, re-fetch and toast anything new. `allPossibleWords` is a dependency
  // because the timeout path finalizes the game server-side only when the reveal list is
  // fetched (lib/game.ts finalizeExpiry), which can land after `isTimeUp` has already
  // flipped from the client clock — a second fetch once the reveal arrives catches it.
  useEffect(() => {
    if (!isTimeUp) return;
    fetchMyAchievements({ toastNew: true });
  }, [isTimeUp, allPossibleWords, fetchMyAchievements]);

  // Auto-dismiss the unlock toast.
  useEffect(() => {
    if (achievementToast.length === 0) return;
    const id = setTimeout(() => setAchievementToast([]), 7000);
    return () => clearTimeout(id);
  }, [achievementToast]);

  // End of game score tracking
  useEffect(() => {
    if (isTimeUp) {
      updateHighScores(scoreAtExpiry);
    }
  }, [isTimeUp, scoreAtExpiry, updateHighScores]);

  const startNewGame = useCallback(async (length = DEFAULT_TARGET_LENGTH, wordlist = DEFAULT_WORDLIST, easyMode = false, daily = false) => {
    try {
      setIsLoading(true)
      setError(null)
      // A daily game (ROADMAP Batch 10 item 1) hits a different start endpoint but returns
      // the same body shape, so beginFromStartResponse is unchanged — it just plays the
      // shared board. easyMode is ignored for the daily (always a normal pick).
      const response = daily
        ? await betuAPI.startDailyGame(wordlist, length)
        : await betuAPI.startGame(length, wordlist, easyMode ? 'easy' : 'normal')
      const ui = beginFromStartResponse(response, { daily })
      // ROADMAP Batch 10 item 14: sync the "next game" selectors to whatever the server
      // actually used for any control the admin has hidden — the server forces it there
      // regardless, this just keeps the (hidden) selector and a later "Új játék" press in
      // step rather than sending a stale value the server would override anyway.
      if (ui && !ui.show_length_selector) setSelectedLength(response.target_length ?? DEFAULT_TARGET_LENGTH)
      if (ui && !ui.show_wordlist_selector) setSelectedWordlist(response.wordlist ?? DEFAULT_WORDLIST)
      if (ui && !ui.show_easy_mode) setSelectedEasyMode(false)
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
  }, [beginFromStartResponse])

  // "Új játék" and every game-restarting selector (length / wordlist / easy mode) route
  // through here. While a game is running, the restart waits behind the confirmation
  // modal; otherwise it runs straight away. ROADMAP Batch 10 item 15's
  // confirm-then-restart-now rule — it replaces the old silent "apply on the next new
  // game" deferral, which made a mid-game selector change look like it did nothing.
  // ROADMAP 13.3: it used to ask only once a word had been found, so a selector change
  // with no words yet ended the running game without a word. Now any running game asks.
  const requestRestart = useCallback((run) => {
    if (!preGame && !isTimeUp) {
      const message = foundWords.length > 0 ? t('confirmModal.message') : t('confirmModal.messageNoScore')
      setPendingConfirm({ message, run })
    } else {
      run()
    }
  }, [preGame, foundWords.length, isTimeUp, t])

  // Give-up asks through the same modal as everything else (ROADMAP 12.5 / 11.6) instead
  // of the browser's own window.confirm.
  const handleGiveUpClick = useCallback(() => {
    setPendingConfirm({
      title: t('giveUpHint.confirmGiveUpTitle'),
      message: t('giveUpHint.confirmGiveUp'),
      confirmLabel: t('giveUpHint.confirmGiveUpButton'),
      run: handleGiveUp,
    })
  }, [t, handleGiveUp])

  // Rooms (ROADMAP 7.2.5). Creating or joining a room leaves any solo game in progress
  // (confirmed first, like every other restart) and shows the lobby on the pre-game board.
  const handleCreateRoom = useCallback((name, mode) => {
    requestRestart(async () => {
      enterPreGame()
      const snapshot = await rooms.create({
        display_name: name,
        mode,
        wordlist: selectedWordlist,
        target_length: selectedLength,
      })
      if (snapshot) setIsSettingsOpen(false)
    })
  }, [requestRestart, enterPreGame, rooms, selectedWordlist, selectedLength])

  const handleJoinRoom = useCallback((code, name) => {
    requestRestart(async () => {
      enterPreGame()
      const snapshot = await rooms.join(code, name)
      if (snapshot) {
        setIsSettingsOpen(false)
        setInviteCode(null)
        clearInviteParam()
      }
    })
  }, [requestRestart, enterPreGame, rooms])

  // ROADMAP 7.2.6 — a room round arrives by polling (the host pressed Start; this client
  // called nothing), so the snapshot's `your_game` is applied here, once per game id —
  // beginFromStartResponse resets the whole board, so it must not re-run on every poll.
  const roomGameRef = useRef(null)
  const roomRevealRef = useRef(null)
  const room = rooms.room
  useEffect(() => {
    const yours = room?.your_game
    if (room?.status !== 'playing' || !yours?.game_active || roomGameRef.current === yours.game_id) return
    roomGameRef.current = yours.game_id
    betuAPI.setActiveGame(yours.game_id)
    beginFromStartResponse(yours, { room: true })
    setIsSettingsOpen(false)
  }, [room, beginFromStartResponse])

  // …and when the room is over: end this player's game if the room ended it for them (a
  // co-op collective clear, with their bonus share), and show every word from the
  // room's reveal — the per-game reveal endpoint withholds it while a room plays (D9).
  useEffect(() => {
    if (room?.status !== 'finished' || !room.reveal || !isRoomGame) return
    if (roomRevealRef.current === room.code) return
    roomRevealRef.current = room.code
    if (!isTimeUp) endGame('room_ended', { bonus: room.reveal.room_cleared ? room.reveal.bonus_per_member : 0 })
    const everyWord = new Set(room.reveal.remaining_words)
    for (const m of room.reveal.members) for (const w of m.words) everyWord.add(w)
    applyRevealWords([...everyWord])
  }, [room, isRoomGame, isTimeUp, endGame, applyRevealWords])

  const leaveRoomToSolo = useCallback(() => {
    roomGameRef.current = null
    roomRevealRef.current = null
    rooms.leave()
    enterPreGame()
  }, [rooms, enterPreGame])

  const handleRematch = useCallback(async () => {
    const snapshot = await rooms.rematch()
    if (snapshot) enterPreGame()
  }, [rooms, enterPreGame])

  const handleJoinRematch = useCallback(async (nextCode) => {
    const me = room?.members.find((m) => m.is_you)
    const snapshot = await rooms.join(nextCode, me?.display_name ?? displayName ?? '')
    if (snapshot) enterPreGame()
  }, [rooms, room, displayName, enterPreGame])

  const inRoomRound = Boolean(room && isRoomGame && ['playing', 'finished'].includes(room.status))

  const dismissInvite = useCallback(() => {
    setInviteCode(null)
    clearInviteParam()
  }, [])

  const handleNewGameClick = useCallback(() => {
    requestRestart(() => startNewGame(selectedLength, selectedWordlist, selectedEasyMode))
  }, [requestRestart, startNewGame, selectedLength, selectedWordlist, selectedEasyMode])

  // Length selector (ROADMAP 2.3): a board's length is fixed for its game, so applying a
  // new one ends the current game. ROADMAP Batch 10 item 17 — it no longer auto-starts a
  // replacement; it drops to the inert pre-game board so the player starts (and the clock
  // starts) when they're ready. The choice is persisted as the player's preference
  // (players.preferred_length) only once it's actually applied — a cancelled confirm
  // leaves both the game and the saved preference untouched.
  const handleLengthChange = useCallback((length) => {
    requestRestart(() => {
      setSelectedLength(length)
      betuAPI.setPreferredLength(length).catch((err) => {
        console.error('Error saving length preference:', err)
      })
      enterPreGame()
    })
  }, [requestRestart, enterPreGame])

  // Wordlist selector (ROADMAP 6.1): also re-fetches available lengths, since the
  // >=500-candidate threshold can admit a different length set per wordlist
  // (lib/game.ts's getAvailableLengths is wordlist-scoped) — falling back to the default
  // length if the current pick isn't offered for the new wordlist. Then to pre-game
  // (item 17), not a fresh game.
  const handleWordlistChange = useCallback((wordlist) => {
    requestRestart(async () => {
      setSelectedWordlist(wordlist)
      try {
        const lengths = await betuAPI.getAvailableLengths(wordlist)
        setAvailableLengths(lengths)
        const nextLength = lengths.includes(selectedLength) ? selectedLength : DEFAULT_TARGET_LENGTH
        setSelectedLength(nextLength)
      } catch (err) {
        console.error('Error loading lengths for wordlist:', err)
      }
      enterPreGame()
    })
  }, [requestRestart, enterPreGame, selectedLength])

  // Easy-mode toggle (ROADMAP Batch 10 "difficulty rating per word"): not a saved
  // preference, so no setPreferred* call — otherwise the same confirm-then-pre-game rule.
  const handleEasyModeChange = useCallback((easyMode) => {
    requestRestart(() => {
      setSelectedEasyMode(easyMode)
      enterPreGame()
    })
  }, [requestRestart, enterPreGame])

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

  // On mount only: load which lengths are worth offering and the player's saved
  // preferences (ROADMAP 2.3 / 6.2, all no-ops for a first-ever visitor with no cookie
  // yet). ROADMAP Batch 10 item 17 — the app then sits on the inert pre-game board; it no
  // longer auto-starts a game (which would start the server clock before the player is
  // looking). `preGame` (useGame) starts `true`; `startNewGame` (from "Új játék") clears it.
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
        const [startup, preferred, preferredLanguage] = await Promise.all([
          betuAPI.getLengthsAndUi(),
          betuAPI.getPreferredLength(),
          betuAPI.getPreferredLanguage(),
        ])
        if (cancelled) return
        let lengths = startup.available_lengths
        if (preferred && lengths.includes(preferred)) initialLength = preferred

        // ROADMAP 13.2: the admin's hidden controls, known before the first game. Without
        // this the settings panel showed every control until a game had started, and the
        // daily panel asked for the saved length while daily/start forced another one.
        const ui = startup.ui
        if (ui) {
          setUiConfig(ui)
          if (!ui.show_wordlist_selector && ui.default_wordlist !== DEFAULT_WORDLIST) {
            setSelectedWordlist(ui.default_wordlist)
            lengths = await betuAPI.getAvailableLengths(ui.default_wordlist)
            if (cancelled) return
          }
          if (!ui.show_length_selector) initialLength = ui.default_length
          if (!ui.show_easy_mode) setSelectedEasyMode(false)
        }
        setAvailableLengths(lengths)

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
      // No startNewGame() here (ROADMAP Batch 10 item 17) — open on the pre-game board.
      // `startNewGame`'s finally-block used to be what cleared the initial spinner.
      setIsLoading(false)
    }
    init()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
                        // Not `onClick={startNewGame}`: the click event would land in the
                        // `length` parameter and reach the API as target_length=[object Object].
                        onClick={() => startNewGame(selectedLength, selectedWordlist, selectedEasyMode)}
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
        <div className="mt-1 flex items-center gap-2">
          {/* ROADMAP 12.5 — the rules, for testers who arrive from a shared link. */}
          <button
            type="button"
            onClick={() => setIsHelpOpen(true)}
            className="inline-flex items-center gap-1.5 text-xs border border-game-border rounded-lg px-3 py-1 text-game-primary bg-game-surface hover:bg-gray-100 dark:hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-game-secondary"
          >
            <span aria-hidden="true">❓</span>
            <span>{t('help.open')}</span>
          </button>
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            aria-label={t('settings.open')}
            title={t('settings.open')}
            className="inline-flex items-center gap-1.5 text-xs border border-game-border rounded-lg px-3 py-1 text-game-primary bg-game-surface hover:bg-gray-100 dark:hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-game-secondary"
          >
            <span aria-hidden="true">⚙️</span>
            <span>{t('settings.open')}</span>
          </button>
        </div>
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

        {/* Room indicator (ROADMAP 7.2.6) — mode + code, where the daily badge would sit
            (a room game is never a daily). */}
        {inRoomRound && (
            <div className="absolute top-0 right-0 p-2 bg-purple-100 dark:bg-purple-950/40 text-purple-800 dark:text-purple-300 text-xs font-bold rounded-bl-lg border-l-2 border-b-2 border-purple-200 dark:border-purple-900" title={t('room.boardBadge', { code: room.code })}>
                {room.mode === 'versus' ? '⚔️' : '👥'} {room.code}
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
          <Scoreboard
            displayScore={displayScore}
            isScoreFlashing={isScoreFlashing}
            preGame={preGame}
            foundWordsCount={foundWords.length}
            possibleWordsCount={possibleWordsCount}
            guessCount={guessCount}
            allPossibleWordsFound={allPossibleWordsFound}
          />
          {/* Hidden on the inert pre-game board (item 17) — no clock running yet. */}
          {!preGame && <Timer timeLeft={timeLeft} />}
        </div>

        {/* Leaderboard toggle + panel moved into <SettingsPanel> (ROADMAP Batch 10 item 15). */}

        {/* ROADMAP 7.2.5 — rooms take over the board area before a round starts: an invite
            prompt (from a ?room= link), the lobby, or a "room closed" notice. */}
        {(() => {
          const room = rooms.room
          if (inviteCode && !rooms.code) {
            return (
              <RoomInvite
                code={inviteCode}
                displayName={displayName}
                busy={rooms.busy}
                error={rooms.error}
                onJoin={handleJoinRoom}
                onDismiss={dismissInvite}
              />
            )
          }
          if (room?.status === 'lobby') {
            return (
              <RoomLobby room={room} busy={rooms.busy} error={rooms.error} onStart={rooms.start} onLeave={rooms.leave} />
            )
          }
          if (room?.status === 'cancelled') {
            return (
              <div className="mb-6 flex flex-col items-center gap-3 text-center">
                <p className="font-semibold">{t('room.cancelled')}</p>
                <button type="button" onClick={rooms.leave} className="text-sm underline text-game-secondary">
                  {t('room.backToSolo')}
                </button>
              </div>
            )
          }
          return null
        })()}

        {!(inviteCode && !rooms.code) && !(rooms.room && ['lobby', 'cancelled'].includes(rooms.room.status)) && (
        <>
        {inRoomRound && room.status === 'finished' && (
          <RoomResults
            room={room}
            busy={rooms.busy}
            error={rooms.error}
            onRematch={handleRematch}
            onJoinRematch={handleJoinRematch}
            onBackToSolo={leaveRoomToSolo}
          />
        )}
        {inRoomRound && room.status === 'playing' && <RoomStrip room={room} />}

        {/* Scrambled letters. ROADMAP 13.1: [data-game-keys] marks the play area (here
            and around the guess/actions block below). Enter/Space on a focused button in
            it still submits the guess (useGame's keydown handler) instead of pressing the
            button; otherwise Enter after clicking Keverés would reshuffle and wipe the
            typed word. `contents` keeps the wrapper out of the layout. */}
        <div data-game-keys className="contents">
        <Board
          preGame={preGame}
          gameWordlist={gameWordlist}
          scrambledLetters={scrambledLetters}
          selectedLength={selectedLength}
          currentAnimatingIndex={currentAnimatingIndex}
          usedLetters={usedLetters}
          onLetterClick={handleLetterClick}
        />
        </div>

        {/* Pre-game start (ROADMAP Batch 10 item 17) — the empty board's only control. It
            reuses handleNewGameClick, so it is literally the "Új játék" action; there is no
            separate "Start" button. The breathe animation draws the eye here. */}
        {preGame && (
          <div className="mb-6 flex justify-center">
            <button
              onClick={handleNewGameClick}
              aria-label={t('actions.newGameAriaLabel')}
              className="animate-breathe h-14 px-8 rounded-full shadow-lg bg-game-secondary text-white text-lg font-semibold hover:bg-blue-600 transition-colors inline-flex items-center justify-center gap-2"
            >
              <span aria-hidden="true">🎲</span>
              <span>{t('actions.newGame')}</span>
            </button>
          </div>
        )}
        </>
        )}

        {!preGame && (
        <div data-game-keys className="contents">
        {/* Current guess input area */}
        <GuessInput
          value={currentGuess}
          onChange={handleGuessChange}
          onClear={() => setCurrentGuess('')}
          isShaking={isGuessShaking}
          errorMessage={guessErrorMsg}
          suggestPrompt={suggestPrompt}
          suggestThanks={suggestThanks}
          suggestLoading={suggestLoading}
          onSuggestWord={handleSuggestWord}
        />

        {/* Action Buttons */}
        <div className="mb-6 flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2 sm:gap-3">
            {/* In a room round "new game" would silently walk out of the room — the room's
                own results offer Rematch / Back to solo instead (ROADMAP 7.2.6). */}
            {!inRoomRound && (
            <button
              onClick={handleNewGameClick}
              aria-label={t('actions.newGameAriaLabel')}
              className="h-12 sm:h-14 w-28 sm:w-32 max-[420px]:w-12 rounded-full shadow-lg bg-game-secondary text-white text-sm sm:text-base font-semibold hover:bg-blue-600 transition-all transform hover:scale-105 active:scale-95 whitespace-nowrap inline-flex items-center justify-center gap-2"
            >
              <span>🎲</span>
              <span className="max-[420px]:hidden">{t('actions.newGame')}</span>
            </button>
            )}
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
              onClick={handleGiveUpClick}
              className="text-xs text-game-muted underline hover:text-red-600"
            >
              {t('giveUpHint.giveUp')}
            </button>
            <button
              onClick={handleUseHint}
              disabled={hintLoading || foundWords.length >= possibleWordsCount}
              title={t('giveUpHint.hintTitle', { cost: hintCost })}
              className="text-xs text-game-secondary underline hover:text-blue-700 dark:hover:text-blue-300 disabled:text-gray-300 dark:disabled:text-slate-600 disabled:no-underline disabled:cursor-not-allowed"
            >
              {t('giveUpHint.hint', { cost: hintCost })}
            </button>
          </div>
        )}

        {hintMessage && (
          <div role="status" aria-live="polite" className="mb-4 text-center text-sm font-semibold text-yellow-700 dark:text-yellow-300 bg-yellow-50 dark:bg-yellow-950/40 border border-yellow-200 dark:border-yellow-900 rounded-lg px-3 py-2">
            {hintMessage}
          </div>
        )}
        </div>
        )}

        {/* Achievement unlock toast (ROADMAP Batch 10 item 10). Word-agnostic copy — a
            badge never names the word that earned it (betuveto-no-player-facing-word-history). */}
        {achievementToast.length > 0 && (
          <div
            role="status"
            aria-live="polite"
            className="mb-4 text-center text-sm font-semibold text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-900 rounded-lg px-3 py-2"
          >
            <p className="mb-1">{t('achievements.unlockedToast')}</p>
            <p className="flex flex-wrap justify-center gap-x-3 gap-y-1">
              {achievementToast.map((key) => (
                <span key={key}>🏆 {t(`achievements.items.${key}.name`)}</span>
              ))}
            </p>
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
        displayName={displayName}
        onDisplayNameChange={setDisplayName}
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
        achievements={achievements}
        achievementsLoading={achievementsLoading}
        daily={dailyView}
        dailyLoading={dailyLoading}
        isDailyGame={isDailyGame}
        onPlayDaily={handlePlayDaily}
        roomPanel={{
          displayName,
          busy: rooms.busy,
          error: rooms.error,
          inRoom: Boolean(rooms.code),
          onCreate: handleCreateRoom,
          onJoin: handleJoinRoom,
        }}
      />

      <HelpPanel
        isOpen={isHelpOpen}
        onClose={() => setIsHelpOpen(false)}
        minWordLength={minWordLength}
        hintCost={hintCost}
      />

      <ConfirmationModal
        isOpen={pendingConfirm !== null}
        onClose={() => setPendingConfirm(null)}
        onConfirm={() => pendingConfirm?.run()}
        message={pendingConfirm?.message ?? ''}
        title={pendingConfirm?.title}
        confirmLabel={pendingConfirm?.confirmLabel}
      />
    </div>
  )
}

export default App
