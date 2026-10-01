/**
 * ROADMAP 11.20 — the Wordle-style daily share card. Word-agnostic by construction: it is
 * built only from counts (found / possible), the score and the streak, never from the
 * board's letters or any found word. The letters are the same for everyone that day, so
 * sharing them would spoil the puzzle, and listing words would break the standing
 * no-per-word-history rule.
 */

/** The text that gets shared. `t` is react-i18next's translate function. */
export function buildDailyShareText(t, daily, url) {
  const result = daily.your_result
  return t('daily.share.text', {
    date: daily.puzzle_date,
    length: daily.target_length,
    found: result.found_count,
    total: daily.possible_count,
    score: result.final_score,
    solved: result.completed ? ' · 🎯' : '',
    streak: daily.streak?.current ?? 0,
    url,
  })
}

/**
 * Shares via the native share sheet where there is one (phones), else copies to the
 * clipboard. Resolves to 'shared' | 'copied' | 'cancelled' | 'failed'. A user dismissing
 * the share sheet rejects with AbortError: that's a choice, not an error, so it maps to
 * 'cancelled' and shows nothing.
 */
export async function shareDailyResult(text) {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ text })
      return 'shared'
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled'
      // Some desktop browsers expose share() but refuse it (e.g. no share target), so
      // fall through to the clipboard rather than failing outright.
    }
  }
  try {
    await navigator.clipboard.writeText(text)
    return 'copied'
  } catch {
    return 'failed'
  }
}
