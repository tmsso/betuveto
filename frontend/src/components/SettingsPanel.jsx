import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import ThemeToggle from './ThemeToggle'
import SoundToggle from './SoundToggle'
import HighScoresPanel from './HighScoresPanel'
import StatsPanel from './StatsPanel'

/**
 * ROADMAP Batch 10 item 15 — start-screen cleanup. Everything that isn't the core play
 * loop (board, guess input, score, timer, action buttons) moves behind one gear button
 * into this slide-over: UI language, colour theme, sound, word length, wordlist, easy
 * mode, and the leaderboard / stats panels.
 *
 * Dialog semantics + focus handling mirror <ConfirmationModal> (ROADMAP Batch 10
 * accessibility pass): role="dialog", focus moves in on open and back to the trigger on
 * close, Escape closes. onClose is read through a ref so the game clock's 500ms
 * re-renders don't re-fire the focus effect (same latest-ref reasoning as the modal).
 */
export default function SettingsPanel({
  isOpen,
  onClose,
  languages,
  language,
  onLanguageChange,
  theme,
  onThemeChange,
  soundEnabled,
  onSoundToggle,
  wordlists,
  selectedWordlist,
  onWordlistChange,
  availableLengths,
  selectedLength,
  onLengthChange,
  selectedEasyMode,
  onEasyModeChange,
  controlsDisabled,
  showHighScores,
  onToggleHighScores,
  serverScores,
  serverScoresLoading,
  highScores,
  targetLength,
  showStats,
  onToggleStats,
  stats,
  statsLoading,
}) {
  const { t } = useTranslation()
  const closeButtonRef = useRef(null)
  const previouslyFocusedRef = useRef(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!isOpen) return
    previouslyFocusedRef.current = document.activeElement
    closeButtonRef.current?.focus()

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previouslyFocusedRef.current?.focus()
    }
  }, [isOpen])

  if (!isOpen) return null

  const fieldRow = 'flex items-center justify-between gap-3 text-sm'
  const selectClass =
    'border-2 border-game-border rounded-lg px-2 py-1 font-bold text-game-primary bg-game-surface focus:outline-none focus:ring-2 focus:ring-game-secondary disabled:opacity-50'

  return (
    <div className="fixed inset-0 z-[10000] flex justify-end">
      <div
        className="absolute inset-0 bg-black bg-opacity-50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-panel-title"
        className="relative h-full w-full max-w-sm overflow-y-auto bg-game-surface shadow-2xl border-l-4 border-game-border p-6 flex flex-col gap-5"
      >
        <div className="flex items-center justify-between">
          <h2 id="settings-panel-title" className="text-2xl font-bold text-game-primary font-display">
            {t('settings.title')}
          </h2>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            aria-label={t('settings.close')}
            className="rounded-full w-9 h-9 flex items-center justify-center text-xl text-game-muted hover:bg-gray-100 dark:hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-game-secondary"
          >
            ✕
          </button>
        </div>

        {/* Display */}
        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-bold uppercase tracking-wide text-game-muted">{t('settings.displaySection')}</h3>
          <div className={fieldRow}>
            <label htmlFor="settings-language" className="text-game-muted font-semibold">
              {t('settings.languageLabel')}
            </label>
            <select
              id="settings-language"
              value={language}
              onChange={(e) => onLanguageChange(e.target.value)}
              aria-label={t('languageSelector.ariaLabel')}
              className={selectClass}
            >
              {languages.map(({ code, label }) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </select>
          </div>
          <div className={fieldRow}>
            <span className="text-game-muted font-semibold">{t('settings.themeLabel')}</span>
            <ThemeToggle theme={theme} setTheme={onThemeChange} />
          </div>
          <div className={fieldRow}>
            <span className="text-game-muted font-semibold">{t('settings.soundLabel')}</span>
            <SoundToggle enabled={soundEnabled} onToggle={onSoundToggle} />
          </div>
        </div>

        {/* Game — changing any of these starts a fresh game (confirmed first if one is in
            progress; see App.jsx's handleLengthChange / handleWordlistChange / handleEasyModeChange). */}
        <div className="flex flex-col gap-3">
          <h3 className="text-xs font-bold uppercase tracking-wide text-game-muted">{t('settings.gameSection')}</h3>
          <div className={fieldRow}>
            <label htmlFor="settings-length" className="text-game-muted font-semibold">
              {t('lengthSelector.label')}
            </label>
            <select
              id="settings-length"
              value={selectedLength}
              disabled={controlsDisabled}
              onChange={(e) => onLengthChange(Number(e.target.value))}
              aria-label={t('lengthSelector.ariaLabel')}
              className={selectClass}
            >
              {availableLengths.map((length) => (
                <option key={length} value={length}>{t('lengthSelector.option', { length })}</option>
              ))}
            </select>
          </div>
          <div className={fieldRow}>
            <label htmlFor="settings-wordlist" className="text-game-muted font-semibold">
              {t('wordlistSelector.label')}
            </label>
            <select
              id="settings-wordlist"
              value={selectedWordlist}
              disabled={controlsDisabled}
              onChange={(e) => onWordlistChange(e.target.value)}
              aria-label={t('wordlistSelector.ariaLabel')}
              className={selectClass}
            >
              {wordlists.map(({ code, label }) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </select>
          </div>
          <div className={fieldRow}>
            <label htmlFor="settings-easy-mode" className="text-game-muted font-semibold flex items-center gap-1.5 cursor-pointer">
              {t('easyModeToggle.label')}
            </label>
            <input
              id="settings-easy-mode"
              type="checkbox"
              checked={selectedEasyMode}
              disabled={controlsDisabled}
              onChange={(e) => onEasyModeChange(e.target.checked)}
              aria-label={t('easyModeToggle.ariaLabel')}
              className="h-4 w-4 accent-game-secondary disabled:opacity-50"
            />
          </div>
        </div>

        {/* Leaderboard */}
        <div className="flex flex-col gap-2">
          <button
            onClick={onToggleHighScores}
            aria-expanded={showHighScores}
            className="text-xs text-game-secondary underline hover:text-blue-700 dark:hover:text-blue-300 self-start"
          >
            {showHighScores ? t('highScores.hide') : t('highScores.show', { length: targetLength })}
          </button>
          {showHighScores && (
            <HighScoresPanel
              serverScores={serverScores}
              serverScoresLoading={serverScoresLoading}
              highScores={highScores}
              targetLength={targetLength}
            />
          )}
        </div>

        {/* Stats */}
        <div className="flex flex-col gap-2">
          <button
            onClick={onToggleStats}
            aria-expanded={showStats}
            className="text-xs text-game-secondary underline hover:text-blue-700 dark:hover:text-blue-300 self-start"
          >
            {showStats ? t('stats.hide') : t('stats.show')}
          </button>
          {showStats && <StatsPanel stats={stats} statsLoading={statsLoading} />}
        </div>
      </div>
    </div>
  )
}
