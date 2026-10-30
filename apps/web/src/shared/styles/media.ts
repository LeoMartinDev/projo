const compact = '(max-width: 640px)'
const short = '(max-height: 560px)'
const touch = '(pointer: coarse)'

/** The named media queries of `media.css` for `matchMedia` (`--fine-pointer` → `finePointer`). */
export const media = {
  compact,
  wide: '(min-width: 1100px)',
  short,
  touch,
  finePointer: '(hover: hover) and (pointer: fine)',
  inBrowser: '(display-mode: browser)',
  installed: '(display-mode: standalone)',
  phone: `${compact} or (${touch} and ${short})`,
  tablet: `${touch} and (not ${compact}) and (not ${short})`,
  desktop: `(not ${touch}) and (not ${compact})`,
} as const

/** Which layout the screen gets (`media.css`): exactly one of the three matches. */
export type Device = 'phone' | 'tablet' | 'desktop'

export const reducedMotion = '(prefers-reduced-motion: reduce)'
