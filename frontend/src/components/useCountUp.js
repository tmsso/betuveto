import { useEffect, useRef, useState } from 'react'

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

/**
 * Animates a number toward `value` (design handback §5, "score count-up"): ease-out over
 * `duration` ms on each change, driven by requestAnimationFrame so it stays in step with
 * paint and stops when the tab is hidden. Under reduced motion it jumps straight there.
 * Only the *visible* number animates — aria-live regions should announce `value` itself.
 */
export default function useCountUp(value, duration = 400) {
  const [shown, setShown] = useState(value)
  const fromRef = useRef(value)

  useEffect(() => {
    const from = fromRef.current
    if (from === value) return
    // Reduced motion: a zero-length animation, i.e. the first frame lands on `value`.
    const ms = reducedMotion() ? 0 : duration
    let frame
    const start = performance.now()
    const step = (now) => {
      const p = ms === 0 ? 1 : Math.min(1, (now - start) / ms)
      const eased = 1 - Math.pow(1 - p, 3) // easeOutCubic
      const v = Math.round(from + (value - from) * eased)
      fromRef.current = v
      setShown(v)
      if (p < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [value, duration])


  return shown
}
