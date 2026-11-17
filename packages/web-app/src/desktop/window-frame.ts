/**
 * The desktop window's frame (§28.4). On Windows the window has none: the page draws the window
 * buttons and WebView2 moves the window from the `app-region: drag` areas. On macOS the system's
 * buttons stay over the page's top left corner, and WebKit has no `app-region`: the page moves the
 * window itself from the same areas (`startsWindowDrag`).
 */
export type WindowFrame = 'drawn' | 'system'

export const windowFrameOf = (userAgent: string): WindowFrame =>
  userAgent.includes('Macintosh') ? 'system' : 'drawn'

/** The title bar's strip at the top of the window, in CSS pixels (window-controls.css). */
export const dragStripHeight = 32

/** What takes the pointer for itself: never part of the title bar (window-controls.css). */
const interactive = [
  '[data-window-no-drag]',
  'a',
  'button',
  'input',
  'select',
  'textarea',
  'label',
  'summary',
  '[contenteditable]',
  '[role="button"]',
  '[role="slider"]',
  '[tabindex]:not([tabindex="-1"])',
  'dialog',
].join(', ')

type Target = { closest: (selector: string) => unknown }

const within = (target: Target, selector: string) =>
  (target.closest(selector) ?? undefined) !== undefined

/** Whether pressing `target` at `clientY` moves the window, as WebView2's drag areas would. */
export const startsWindowDrag = (target: Target, clientY: number): boolean => {
  if (within(target, interactive)) return false
  return clientY < dragStripHeight || within(target, '[data-window-drag]')
}
