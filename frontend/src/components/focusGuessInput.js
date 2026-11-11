/**
 * Focus the guess field only where that doesn't summon an on-screen keyboard.
 *
 * Phones and tablets open their keyboard the moment a text field gets focus, covering half
 * the board. There the player taps letter tiles instead and opens the keyboard by tapping
 * the field themselves. A mouse (`pointer: fine`) means a desktop with a real keyboard,
 * where focusing lets the player just start typing.
 *
 * Asks about the input device, not the screen width: a phone held sideways is wider than
 * the old 640px cut-off and still has only an on-screen keyboard.
 */
export function hasPhysicalKeyboard() {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: fine)').matches)
}

export function focusGuessInput() {
  const input = document.getElementById('guess-input')
  if (!input) return
  if (hasPhysicalKeyboard()) input.focus()
  else input.blur()
}
