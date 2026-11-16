import { focusableSelector, isUsable } from '../focusable.ts'
import {
  type Direction,
  isHorizontal,
  isInView,
  pickInDirection,
  type Rect,
  runsAcross,
  scrollDelta,
} from './geometry.ts'
import { choosesOnStep, type WidgetKind, widgetStepIndex } from './widget-step.ts'

// Spatial navigation in the page (§19): the arrows move focus to the element
// that lies that way. Markup tells it what the page is made of:
// - `data-nav-row`: a row (home row, hero actions, a control bar); ←/→ go
//   through its elements in order and stay in it, ↑/↓ leave it. A row
//   remembers its last focused element: entering it again goes back there
//   (else to its `data-nav-primary`, else to the element nearest the move).
// - `data-nav-roving` (on a row): one Tab stop for the row, its remembered
//   element (roving tabindex).
// - `data-nav-aside`: reached only by ←/→ inside its row (a "See all" link in
//   the row's head), never by ↑/↓.
// - `data-nav-skip`: never reached by the arrows (a card's hover actions,
//   a control that repeats another one).
// - `data-nav-primary`: what the first arrow focuses when nothing has focus
//   (the element, or the first one inside it: a grid's first cell).
// - `data-nav-sticky`: a header stuck at the top; scrolling keeps focus below it.

const rowSelector = '[data-nav-row]'
const marginPx = 16

let memory = new WeakMap<Element, HTMLElement>()

/** Rows remember nothing of another page (React may reuse a row element for another title). */
export const forgetRows = () => {
  memory = new WeakMap()
}

// A visually hidden input (a colour swatch's radio) is drawn by its label.
const drawnBy = (element: Element): Element => {
  const rect = element.getBoundingClientRect()
  const label = element instanceof HTMLInputElement ? element.labels?.[0] : undefined
  return rect.width <= 2 && rect.height <= 2 && label !== undefined ? label : element
}

const inSticky = (element: Element) =>
  (element.closest('[data-nav-sticky]') ?? undefined) !== undefined

const rectOf = (element: Element): Rect => drawnBy(element).getBoundingClientRect()

// The sticky header sits above the whole page, not over what scrolled under
// it: ↑ goes up the page first, and reaches the header at its top.
const pageRectOf = (element: Element): Rect => {
  const rect = rectOf(element)
  if (!inSticky(element)) return rect
  const above = document.documentElement.scrollHeight + window.innerHeight
  return { left: rect.left, right: rect.right, top: rect.top - above, bottom: rect.bottom - above }
}

// A radio group is reached through its checked radio, as with Tab.
const isGroupedAway = (element: HTMLElement) => {
  if (!(element instanceof HTMLInputElement) || element.type !== 'radio' || element.checked)
    return false
  if (element.name === '') return false
  const scope = element.form ?? element.ownerDocument
  return [...scope.querySelectorAll<HTMLInputElement>('input[type="radio"]')].some(
    (other) => other.name === element.name && other.checked,
  )
}

const visible = (element: HTMLElement) =>
  typeof element.checkVisibility !== 'function' ||
  element.checkVisibility({ visibilityProperty: true })

/** An element the arrows can focus (its row may have taken it out of the Tab order). */
export const isNavigable = (element: HTMLElement) =>
  element.matches(focusableSelector) &&
  (element.tabIndex >= 0 || (element.closest('[data-nav-roving]') ?? undefined) !== undefined) &&
  (element.closest('[data-nav-skip], [aria-hidden="true"]') ?? undefined) === undefined &&
  isUsable(element) &&
  visible(element) &&
  !isGroupedAway(element)

/** The navigable elements of `root`, in document order. */
export const navigablesIn = (root: ParentNode): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(focusableSelector)].filter(isNavigable)

/** The open modal dialog on top, if any. */
export const topModal = (): HTMLDialogElement | undefined =>
  [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')]
    .filter((dialog) => dialog.matches(':modal'))
    .at(-1)

/**
 * Where the arrows move: an open popover or menu holding focus (the account
 * menu, a row's menu), else the open modal dialog on top, else the document.
 */
export const navigationRoot = (): ParentNode => {
  const modal = topModal()
  const menu = document.activeElement?.closest<HTMLElement>('[popover], [role="menu"]') ?? undefined
  const open =
    menu !== undefined && (!menu.hasAttribute('popover') || menu.matches(':popover-open'))
  if (menu !== undefined && open && (modal === undefined || modal.contains(menu))) return menu
  return modal ?? document
}

/** A scrolling box (logs, a long list): the arrows scroll it. */
export const isScroller = (element: Element) => {
  if (element === document.body || element === document.documentElement) return false
  const style = getComputedStyle(element)
  return (
    (scrolls(style.overflowY) && element.scrollHeight > element.clientHeight) ||
    (scrolls(style.overflowX) && element.scrollWidth > element.clientWidth)
  )
}

// A popover or a dialog inside a row (the account menu in the header) is not part of it.
const ownRowOf = (element: Element) => {
  const holder = element.closest<HTMLElement>(`${rowSelector}, [popover], dialog`) ?? undefined
  return holder?.matches(rowSelector) === true ? holder : undefined
}

const rowOf = (element: Element, root: ParentNode) => {
  const row = ownRowOf(element)
  return row !== undefined && (root === document || (root as Node).contains(row)) ? row : undefined
}

/** The navigable elements of a row, in order. */
const membersOf = (row: HTMLElement) =>
  navigablesIn(row).filter((element) => ownRowOf(element) === row)

const isAside = (element: Element) =>
  (element.closest('[data-nav-aside]') ?? undefined) !== undefined

const stickyTop = () =>
  Math.max(
    0,
    ...[...document.querySelectorAll<HTMLElement>('[data-nav-sticky]')].map((element) => {
      const rect = element.getBoundingClientRect()
      return rect.top <= 1 && rect.height > 0 ? rect.bottom : 0
    }),
  )

const scrolls = (value: string) => value === 'auto' || value === 'scroll'

/**
 * Scrolls `element` into view: inside its scrolling ancestors, then in the
 * window, below the sticky header. Never scrolls a clipped row (`overflow:
 * hidden`): a paged row pages itself on focus.
 */
export const reveal = (element: HTMLElement) => {
  for (
    let parent = element.parentElement ?? undefined;
    parent !== undefined && parent !== document.body && parent !== document.documentElement;
    parent = parent.parentElement ?? undefined
  ) {
    const style = getComputedStyle(parent)
    const box = parent.getBoundingClientRect()
    const rect = element.getBoundingClientRect()
    if (scrolls(style.overflowY) && parent.scrollHeight > parent.clientHeight)
      parent.scrollTop += scrollDelta(
        { start: rect.top, end: rect.bottom },
        { start: box.top, end: box.top + parent.clientHeight },
        marginPx / 2,
      )
    if (scrolls(style.overflowX) && parent.scrollWidth > parent.clientWidth)
      parent.scrollLeft += scrollDelta(
        { start: rect.left, end: rect.right },
        { start: box.left, end: box.left + parent.clientWidth },
        marginPx / 2,
      )
  }
  if ((element.closest('dialog') ?? undefined) !== undefined || inSticky(element)) return
  const rect = element.getBoundingClientRect()
  const delta = scrollDelta(
    { start: rect.top, end: rect.bottom },
    { start: stickyTop(), end: window.innerHeight },
    marginPx,
  )
  if (delta !== 0) window.scrollBy({ top: delta, behavior: 'instant' })
}

export const focusAndReveal = (element: HTMLElement) => {
  element.focus({ preventScroll: true })
  reveal(element)
}

const primariesIn = (root: ParentNode) =>
  [...root.querySelectorAll<HTMLElement>('[data-nav-primary]')]
    .map((element) => (isNavigable(element) ? element : navigablesIn(element)[0]))
    .filter((element) => element !== undefined)

const viewRect = (): Rect => ({
  left: 0,
  top: stickyTop(),
  right: window.innerWidth,
  bottom: window.innerHeight,
})

/**
 * What the first arrow focuses when nothing has focus: the page's primary
 * element in view, else the first element in view in the page's main region,
 * else the primary element wherever it is, else the first one.
 */
export const startElement = (root: ParentNode): HTMLElement | undefined => {
  const primary = primariesIn(root)
  const view = viewRect()
  const shows = (element: HTMLElement) => isInView(rectOf(element), view)
  const main = root === document ? (document.getElementById('main') ?? undefined) : undefined
  const all = navigablesIn(main ?? root)
  return (
    primary.find(shows) ??
    all.find((element) => !isAside(element) && shows(element)) ??
    primary[0] ??
    all[0]
  )
}

// Focus left nowhere: the page itself, its main region, a dialog's own box.
const isAdrift = (active: Element | undefined, root: ParentNode) =>
  active === undefined ||
  active === document.body ||
  !active.isConnected ||
  !(root === document || (root as Node).contains(active)) ||
  !(active instanceof HTMLElement) ||
  !(isNavigable(active) || isWidgetItem(active))

/** Which element of row `row` to focus when the arrows enter it from outside. */
const entryOf = (row: HTMLElement, reached: HTMLElement) => {
  const remembered = memory.get(row)
  if (remembered !== undefined && row.contains(remembered) && isNavigable(remembered))
    return remembered
  const primary = primariesIn(row)[0]
  return primary ?? reached
}

/** The element an arrow moves focus to from `origin`, if any. */
export const targetFrom = (
  origin: HTMLElement,
  direction: Direction,
  root: ParentNode,
): HTMLElement | undefined => {
  const row = rowOf(origin, root)
  if (row !== undefined && isHorizontal(direction)) {
    const members = membersOf(row)
    const index = members.indexOf(origin)
    if (index >= 0) return members[index + (direction === 'right' ? 1 : -1)]
    const others = members.filter((element) => element !== origin)
    const picked = pickInDirection(rectOf(origin), others.map(rectOf), direction)
    return picked === undefined ? undefined : others[picked]
  }
  // From the sticky header, ↑ stays in it (what scrolled under it lies below the page's top).
  const fromHeader = inSticky(origin)
  const candidates = navigablesIn(root).filter(
    (element) =>
      element !== origin &&
      !isAside(element) &&
      !origin.contains(element) &&
      (!fromHeader || direction !== 'up' || inSticky(element)),
  )
  const picked = pickInDirection(
    rectOf(origin),
    candidates.map(fromHeader ? rectOf : pageRectOf),
    direction,
  )
  const reached = picked === undefined ? undefined : candidates[picked]
  if (reached === undefined) return undefined
  const entered = rowOf(reached, root)
  return entered === undefined || entered === rowOf(origin, root)
    ? reached
    : entryOf(entered, reached)
}

const retryFrames = 6

// Nothing more that way in what is rendered: scroll on, and try again once the
// page rendered what came into view (a virtualised grid, rows loaded on demand).
const scrollOn = (direction: Direction, origin: HTMLElement) => {
  // The header does not scroll with the page.
  if (isHorizontal(direction) || inSticky(origin)) return false
  const before = window.scrollY
  window.scrollBy({
    top: (direction === 'down' ? 1 : -1) * window.innerHeight * 0.4,
    behavior: 'instant',
  })
  if (window.scrollY === before) return false
  let frames = 0
  const retry = () => {
    if (document.activeElement !== origin) return
    const target = origin.isConnected ? targetFrom(origin, direction, document) : undefined
    if (target !== undefined) focusAndReveal(target)
    else if ((frames += 1) < retryFrames) requestAnimationFrame(retry)
  }
  requestAnimationFrame(retry)
  return true
}

// A widget whose items the arrows cannot all reach (a roving tabindex: tabs, a
// menu's radios, a select's options; a group of radio inputs) moves with the
// arrow keys by itself, before any intent. A "move" intent with no key (a
// gamepad) steps through its items here, in order along its axis; at its ends
// or across it, focus leaves it as usual (widget-step.ts: only a radio input
// is chosen as it gets focus; a tab waits for "activate").
const widgets = [
  { item: '[role="tab"]', group: '[role="tablist"]', kind: 'tab' },
  { item: '[role="radio"]', group: '[role="radiogroup"]', kind: 'radio' },
  { item: '[role="option"]', group: '[role="listbox"]', kind: 'option' },
] as const

const widgetItemsOf = (
  origin: HTMLElement,
): { items: HTMLElement[]; kind: WidgetKind } | undefined => {
  if (origin instanceof HTMLInputElement && origin.type === 'radio') {
    if (origin.name === '') return undefined
    const scope = origin.form ?? origin.ownerDocument
    const items = [...scope.querySelectorAll<HTMLInputElement>('input[type="radio"]')].filter(
      (radio) => radio.name === origin.name,
    )
    return { items, kind: 'radio_input' }
  }
  const widget = widgets.find(({ item }) => origin.matches(item))
  const group = widget === undefined ? undefined : (origin.closest(widget.group) ?? undefined)
  if (widget === undefined || group === undefined) return undefined
  return { items: [...group.querySelectorAll<HTMLElement>(widget.item)], kind: widget.kind }
}

// An item a widget gave focus to out of the Tab order (an option, a tab): not adrift.
const isWidgetItem = (element: HTMLElement) =>
  isUsable(element) && widgetItemsOf(element) !== undefined

/** The item a "move" intent steps to inside `origin`'s widget, if any. */
const widgetStep = (origin: HTMLElement, direction: Direction) => {
  const widget = widgetItemsOf(origin)
  if (widget === undefined) return undefined
  const items = widget.items.filter((item) => item === origin || isUsable(item))
  if (items.every(isNavigable)) return undefined
  const index = widgetStepIndex({
    index: items.indexOf(origin),
    count: items.length,
    across: runsAcross(items.map(rectOf)),
    direction,
  })
  const next = index === undefined ? undefined : items[index]
  return next === undefined ? undefined : { next, choose: choosesOnStep(widget.kind) }
}

/**
 * Moves focus one step in `direction` (the "move" intent). Inside `scope`
 * when given (the player), else in the open modal dialog or the page. True
 * when something moved (focus or the page).
 */
export const moveFocus = (direction: Direction, scope?: ParentNode): boolean => {
  const root = scope ?? navigationRoot()
  const active = document.activeElement ?? undefined
  if (isAdrift(active, root)) {
    const start = startElement(root)
    if (start === undefined) return false
    focusAndReveal(start)
    return true
  }
  const origin = active as HTMLElement
  const step = widgetStep(origin, direction)
  if (step !== undefined) {
    focusAndReveal(step.next)
    if (step.choose) step.next.click()
    return true
  }
  const target = targetFrom(origin, direction, root)
  if (target !== undefined) {
    focusAndReveal(target)
    return true
  }
  return scope === undefined && root === document ? scrollOn(direction, origin) : false
}

const clickedRoles = ['checkbox', 'radio', 'switch', 'tab', 'option', 'menuitem']

/**
 * Activates what has focus (the "activate" intent): clicks it; with nothing
 * focused, focuses the page's start element.
 */
export const activateFocus = (scope?: ParentNode): boolean => {
  const root = scope ?? navigationRoot()
  const active = document.activeElement ?? undefined
  if (isAdrift(active, root)) {
    const start = startElement(root)
    if (start === undefined) return false
    focusAndReveal(start)
    return true
  }
  const element = active as HTMLElement
  const input = element instanceof HTMLInputElement ? element.type : undefined
  const clickable =
    element.matches('a[href], button, summary') ||
    ['checkbox', 'radio', 'button', 'submit', 'reset'].includes(input ?? '') ||
    clickedRoles.includes(element.getAttribute('role') ?? '')
  if (!clickable) return false
  element.click()
  return true
}

/** Remembers `element` as its row's last focused element. */
export const rememberFocus = (element: HTMLElement) => {
  const row = ownRowOf(element)
  if (row !== undefined && isNavigable(element)) memory.set(row, element)
}

/** One Tab stop for a `data-nav-roving` row: its remembered element, else its first. */
export const updateRovingRow = (row: HTMLElement) => {
  const members = membersOf(row).filter((element) => !isAside(element))
  const remembered = memory.get(row)
  const stop = remembered !== undefined && members.includes(remembered) ? remembered : members[0]
  for (const member of members) {
    const tabIndex = member === stop ? 0 : -1
    if (member.tabIndex !== tabIndex) member.tabIndex = tabIndex
  }
}

export const updateRovingRows = (root: ParentNode = document) => {
  for (const row of root.querySelectorAll<HTMLElement>('[data-nav-roving]')) updateRovingRow(row)
}
