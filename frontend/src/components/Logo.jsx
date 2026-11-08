import markUrl from '../assets/brand/logo-mark.svg'
import markOnBrandUrl from '../assets/brand/logo-mark-on-brand.svg'

/**
 * The B·V tile mark (design handback §1). An <img> of the outlined SVG rather than inline
 * markup: it's decorative next to the real-text wordmark, so alt="" keeps screen readers
 * from announcing the name twice. `onBrand` = the saffron-V colouring for teal grounds.
 */
export function LogoMark({ size = 48, onBrand = false, className = '' }) {
  return (
    <img
      src={onBrand ? markOnBrandUrl : markUrl}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      className={className}
    />
  )
}

/**
 * The wordmark as plain live text. The owner review of 2026-11-08 dropped the saffron
 * accent overlay and the extra-bold display face: the title is now the app's normal
 * Nunito in a lighter teal (`--game-title`), nothing else.
 */
export function Wordmark({ text, className = '' }) {
  return <h1 className={`wordmark ${className}`}>{text}</h1>
}
