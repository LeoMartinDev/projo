// What keyboard focus can land on, for the code that moves it by hand (menus,
// the player, navigations).

export const focusableSelector = 'a[href], button, input, select, textarea, [tabindex]'

/** Shown, enabled and outside an inert region: focus can go there. */
export const isUsable = (element: HTMLElement | undefined): element is HTMLElement =>
  element !== undefined &&
  !element.matches(':disabled') &&
  (element.closest('[inert]') ?? undefined) === undefined &&
  element.getClientRects().length > 0

/** The usable elements of `root` in the Tab order of the page (tabIndex ≥ 0). */
export const tabbablesIn = (root: ParentNode): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(focusableSelector)].filter(
    (element) => element.tabIndex >= 0 && isUsable(element),
  )

const nonTextInputs = [
  'range',
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'image',
  'color',
  'file',
]
const lineInputs = ['text', 'search', 'email', 'url', 'tel', 'password']

/** Where keys type text: a text field, a text area, an editable region. */
export const isTextEntry = (target: EventTarget | undefined): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.tagName === 'TEXTAREA' ||
    (target instanceof HTMLInputElement && !nonTextInputs.includes(target.type)))

/** A single-line text field (not a number or a date: their arrows change the value). */
export const isLineField = (target: EventTarget | undefined) =>
  target instanceof HTMLInputElement && lineInputs.includes(target.type)
