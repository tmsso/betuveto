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
 * The wordmark as plain live text: Baloo 2 700 (the letter-tile face) in the button teal
 * (`--game-secondary`), no accent overlay. Owner picked it from six variants, 2026-11-09.
 */
export function Wordmark({ text, className = '' }) {
  return <h1 className={`wordmark ${className}`}>{text}</h1>
}
