/**
 * ROADMAP Batch 10 item 8 — sound effects, synthesised with the Web Audio API rather
 * than shipped as audio files: no assets to license, bundle, or PWA-precache, and it
 * matches this repo's "hand-roll the small thing" convention (no chart lib, no component
 * lib). Four short cues, all built from a plain oscillator + gain envelope.
 *
 * The AudioContext is created lazily on the first `playCue` call — which only ever
 * happens inside a user-gesture handler (a guess submit, a hint click), so the browser
 * autoplay policy is satisfied. `resume()` covers the case where it still starts
 * suspended.
 */

let ctx = null

function audioCtx() {
  if (ctx) return ctx
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return null
  ctx = new AC()
  return ctx
}

/** One oscillator note with a short attack/decay envelope. `delay` staggers arpeggios. */
function note(context, { freq, type = 'sine', start, duration, peak = 0.18 }) {
  const osc = context.createOscillator()
  const gain = context.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, start)
  // Fast fade in/out so notes don't click.
  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  osc.connect(gain).connect(context.destination)
  osc.start(start)
  osc.stop(start + duration + 0.02)
}

const CUES = {
  // A quick rising two-note blip — "yes, that counted".
  correct: (c, t) => {
    note(c, { freq: 660, start: t, duration: 0.1 })
    note(c, { freq: 880, start: t + 0.08, duration: 0.12 })
  },
  // A low, short buzz — "no".
  reject: (c, t) => {
    note(c, { freq: 170, type: 'sawtooth', start: t, duration: 0.16, peak: 0.14 })
  },
  // A single soft mid ping for a revealed hint letter.
  hint: (c, t) => {
    note(c, { freq: 880, type: 'triangle', start: t, duration: 0.14, peak: 0.14 })
  },
  // A C-major arpeggio for clearing the whole board.
  fullClear: (c, t) => {
    ;[523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
      note(c, { freq, start: t + i * 0.1, duration: 0.22 })
    })
  },
}

/** Play a named cue. Silently a no-op if Web Audio is unavailable or the name is unknown;
 *  the caller (useSound) is responsible for the enabled/disabled check. */
export function playCue(name) {
  const cue = CUES[name]
  if (!cue) return
  const context = audioCtx()
  if (!context) return
  if (context.state === 'suspended') context.resume().catch(() => {})
  try {
    cue(context, context.currentTime)
  } catch {
    /* a transient audio error must never break gameplay */
  }
}
