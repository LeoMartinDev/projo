import { type KeyboardEvent, useEffect } from 'react'

import { isTextEntry, isUsable, tabbablesIn } from '../../../shared/ui/focusable.ts'

// Keyboard focus in the player's menus (§10.7): a menu takes focus when it
// opens (its checked option, else its first control), holds it (Tab and
// Shift+Tab cycle inside), and ↑/↓, Home/End move between the options of a
// radio group, whose tab stop is the checked option (roving tabindex), or
// between the buttons of a list (`data-arrow-list`: the chapters); past either
// end, ↑/↓ go on to the menu's previous or next control, as they do from any
// other control, so the arrows alone reach every setting. A slider (the speed)
// keeps ←/→; ↑/↓ leave it.

/** Index after a step through a list of `count`, wrapping around; Home and End are ±Infinity. */
export const steppedIndex = (index: number, step: number, count: number) =>
  count === 0
    ? -1
    : step === Number.NEGATIVE_INFINITY
      ? 0
      : step === Number.POSITIVE_INFINITY
        ? count - 1
        : (((index + step) % count) + count) % count

const stepOf = (key: string) =>
  key === 'ArrowDown' || key === 'ArrowRight'
    ? 1
    : key === 'ArrowUp' || key === 'ArrowLeft'
      ? -1
      : key === 'Home'
        ? Number.NEGATIVE_INFINITY
        : key === 'End'
          ? Number.POSITIVE_INFINITY
          : 0

/** Index after an ↑/↓ step through a list of `count`: undefined past either end (focus leaves it). */
export const leavingIndex = (index: number, step: number, count: number): number | undefined => {
  const next = index + step
  return next >= 0 && next < count ? next : undefined
}

/** Tab stops of options: the checked ones, else the first (a group stays reachable). */
export const tabStops = (checked: readonly boolean[]): readonly boolean[] =>
  checked.some(Boolean) ? checked : checked.map((_, index) => index === 0)

const initialFocusIn = (menu: HTMLElement) => {
  const marked = [...menu.querySelectorAll<HTMLElement>('[data-initial-focus]')].find(isUsable)
  const scope = marked ?? menu
  const preferred = [
    ...scope.querySelectorAll<HTMLElement>(
      '[role="radio"][aria-checked="true"], [aria-current="true"], [role="slider"]',
    ),
  ].find(isUsable)
  return preferred ?? tabbablesIn(scope)[0] ?? tabbablesIn(menu)[0]
}

/** Moves focus into the menu once it opens (`key`: which menu). */
export const useMenuFocus = (menu: HTMLElement | undefined, key: string | undefined) => {
  useEffect(() => {
    if (menu === undefined || key === undefined) return
    initialFocusIn(menu)?.focus()
  }, [menu, key])
}

// The options the arrows move between from `target`, if it is one.
const arrowOptionsOf = (target: HTMLElement) => {
  const group =
    target.getAttribute('role') === 'radio'
      ? (target.closest('[role="radiogroup"]') ?? undefined)
      : target.tagName === 'BUTTON'
        ? (target.closest('[data-arrow-list]') ?? undefined)
        : undefined
  const selector = target.getAttribute('role') === 'radio' ? '[role="radio"]' : 'button'
  return group === undefined
    ? undefined
    : [...group.querySelectorAll<HTMLElement>(selector)].filter(isUsable)
}

// The menu's previous or next tab stop from `from`, wrapping around; a radio
// group is one stop, left whichever option has focus.
const stopBeside = (menu: HTMLElement, from: HTMLElement, backwards: boolean) => {
  const group = from.closest('[role="radiogroup"]') ?? undefined
  const others = tabbablesIn(menu).filter(
    (element) => element !== from && (group === undefined || !group.contains(element)),
  )
  const follows = (element: HTMLElement) =>
    (from.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  return backwards
    ? (others.findLast((element) => !follows(element)) ?? others.at(-1))
    : (others.find(follows) ?? others[0])
}

const verticalKeys = ['ArrowUp', 'ArrowDown']

const moveWithArrows = (event: KeyboardEvent<HTMLElement>, target: HTMLElement) => {
  const step = stepOf(event.key)
  if (step === 0 || event.defaultPrevented) return
  const vertical = verticalKeys.includes(event.key)
  const options = arrowOptionsOf(target)
  if (options === undefined) {
    // Any other control (a slider, a switch, a tab, a button): ↑/↓ go on to the next one.
    if (!vertical || isTextEntry(target)) return
    event.preventDefault()
    stopBeside(event.currentTarget, target, step < 0)?.focus()
    return
  }
  event.preventDefault()
  const index = options.indexOf(target)
  const next = vertical
    ? leavingIndex(index, step, options.length)
    : steppedIndex(index, step, options.length)
  const destination =
    next === undefined ? stopBeside(event.currentTarget, target, step < 0) : options[next]
  destination?.focus()
}

const cycleTab = (event: KeyboardEvent<HTMLElement>, menu: HTMLElement) => {
  const active = document.activeElement
  const first = tabbablesIn(menu)[0]
  if (first === undefined) return
  event.preventDefault()
  if (!(active instanceof HTMLElement) || !menu.contains(active)) {
    first.focus()
    return
  }
  stopBeside(menu, active, event.shiftKey)?.focus()
}

/** The menu's keydown: holds Tab inside, moves between options with the arrows. */
export const onMenuKeyDown = (event: KeyboardEvent<HTMLElement>) => {
  if (event.altKey || event.ctrlKey || event.metaKey) return
  if (event.key === 'Tab') {
    cycleTab(event, event.currentTarget)
    return
  }
  if (event.target instanceof HTMLElement) moveWithArrows(event, event.target)
}
