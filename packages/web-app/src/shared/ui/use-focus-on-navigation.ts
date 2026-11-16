import { useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'

import { createFocusMemory, type FocusKey, focusKeyOf, navigationKind } from './focus-restore.ts'
import { isUsable } from './focusable.ts'
import { currentModality } from './input-modality.ts'
import { isNavigable, navigablesIn } from './spatial-nav/spatial-nav.ts'

// Focus across navigations (§19): a page reached forward takes focus on its
// main region (`#main`, tabIndex -1, no ring), so the next Tab goes on in the
// page instead of the skip link; a page reached back gets focus on the element
// the user left it from (`data-focus-key`, else the link's href), once it is
// rendered, given up after a few seconds or at the first pointer press. Only
// for a page left with the keyboard: a pointer leaves no key.

const restoreWaitMs = 3000

type HistoryEntry = {
  pathname: string
  href: string
  state: { __TSR_index: number; __TSR_key?: string; key?: string }
}

const entryOf = (location: HistoryEntry) =>
  location.state.__TSR_key ?? location.state.key ?? location.href

const keyOfElement = (element: Element): FocusKey | undefined => {
  const keyed = element.closest<HTMLElement>('[data-focus-key]') ?? undefined
  const link = element.closest('a[href]') ?? undefined
  return focusKeyOf({
    focusKey: keyed?.dataset['focusKey'],
    href: link?.getAttribute('href') ?? undefined,
  })
}

const elementOfKey = (key: FocusKey): HTMLElement | undefined => {
  const found =
    key.kind === 'href'
      ? [...document.querySelectorAll<HTMLElement>('a[href]')].filter(
          (link) => link.getAttribute('href') === key.value,
        )
      : [...document.querySelectorAll<HTMLElement>('[data-focus-key]')].filter(
          (element) => element.dataset['focusKey'] === key.value,
        )
  // A card of a row may be out of the Tab order (one Tab stop per row).
  return found
    .filter(isUsable)
    .map((element) => (isNavigable(element) ? element : navigablesIn(element)[0]))
    .find((element) => element !== undefined)
}

const mainRegion = () => document.getElementById('main') ?? undefined

const focusMain = () => mainRegion()?.focus({ preventScroll: true })

// Focus that a navigation left behind: nothing, the page itself, its main
// region, or an element the navigation hid (a kept tab).
const unclaimed = (active: Element | undefined) =>
  active === undefined ||
  active === document.body ||
  !active.isConnected ||
  active === mainRegion() ||
  active.getClientRects().length === 0

export const useFocusOnNavigation = () => {
  const router = useRouter()

  useEffect(() => {
    const memory = createFocusMemory()
    let trigger: Element | undefined
    let cancelWait = () => {}

    const restore = (key: FocusKey) => {
      const deadline = performance.now() + restoreWaitMs
      let frame = 0
      const attempt = () => {
        if (!unclaimed(document.activeElement ?? undefined)) {
          cancelWait()
          return
        }
        const element = elementOfKey(key)
        if (element !== undefined) {
          element.focus({ preventScroll: true })
          cancelWait()
          return
        }
        if (performance.now() < deadline) frame = requestAnimationFrame(attempt)
        else cancelWait()
      }
      // A press on the page (which may focus #main) ends the wait.
      const stop = () => {
        cancelAnimationFrame(frame)
        document.removeEventListener('pointerdown', stop, true)
      }
      document.addEventListener('pointerdown', stop, true)
      cancelWait = stop
      attempt()
    }

    const stopBefore = router.subscribe('onBeforeNavigate', ({ fromLocation }) => {
      cancelWait()
      const active = document.activeElement ?? undefined
      trigger = active
      if (fromLocation === undefined) return
      const keyboard = active instanceof HTMLElement && currentModality() === 'keyboard'
      memory.remember(
        entryOf(fromLocation),
        keyboard && active !== mainRegion() ? keyOfElement(active) : undefined,
      )
    })

    const stopRendered = router.subscribe('onRendered', ({ fromLocation, toLocation }) => {
      cancelWait()
      const kind = navigationKind(
        fromLocation === undefined
          ? undefined
          : { pathname: fromLocation.pathname, index: fromLocation.state.__TSR_index },
        { pathname: toLocation.pathname, index: toLocation.state.__TSR_index },
      )
      const active = document.activeElement ?? undefined
      // A page that took focus itself (a field, a dialog) keeps it.
      const free = unclaimed(active) || active === trigger
      trigger = undefined
      if (kind === 'none' || !free) return
      const pathChanged = fromLocation?.pathname !== toLocation.pathname
      if (pathChanged) focusMain()
      const key = kind === 'back' ? memory.recall(entryOf(toLocation)) : undefined
      if (key !== undefined) restore(key)
    })

    return () => {
      cancelWait()
      stopBefore()
      stopRendered()
    }
  }, [router])
}
