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

// Letters whose double acute is drawn in saffron.
const ACCENTED = new Set(['ű', 'ő', 'Ű', 'Ő'])

/**
 * The wordmark as live text (handback §1.3): the <h1> keeps its plain accessible name
 * ("Betűvető"), and each ű/ő gets an aria-hidden copy of itself on top, clipped to the
 * accent zone (the top 0.26em of a line-height:1 box), coloured saffron. So the font's own
 * accent glyphs are recoloured — no hand-drawn accents, no image.
 */
export function Wordmark({ text, className = '' }) {
  return (
    // aria-label pins the accessible name: the absolutely positioned overlay spans make
    // Chromium's name computation insert a space ("Betű vető") even though they're hidden.
    <h1 className={`wordmark ${className}`} aria-label={text}>
      {[...text].map((ch, i) =>
        ACCENTED.has(ch) ? (
          <span key={i} className="wordmark-accented">
            {ch}
            <span aria-hidden="true">{ch}</span>
          </span>
        ) : (
          ch
        ),
      )}
    </h1>
  )
}
