import { useRouter } from '@tanstack/react-router'
import { useEffect } from 'react'

import { isLineField, isTextEntry } from '../focusable.ts'
import { bindBack, dispatchIntent, intentsClaimed, layerOpen } from './intents.ts'
import { backKeys, canGoBackFrom, directionOfKey, intentOfKey, type KeyTarget } from './keys.ts'
import {
  forgetRows,
  isScroller,
  rememberFocus,
  updateRovingRow,
  updateRovingRows,
} from './spatial-nav.ts'

// The keyboard adapter of the intent layer (§19), mounted once by the root
// route: ↑ ↓ ← → move, Enter activates, Escape, Backspace and the back keys go
// back. Listens on the document after the page's own handlers, so a key they
// took (`preventDefault`: season tabs, menus, a select's list) stays theirs.

const arrowRoles = ['spinbutton', 'listbox', 'option', 'combobox', 'grid', 'tree', 'treeitem']
const nativeEnter =
  'a[href], button, summary, input[type="submit"], input[type="button"], input[type="reset"], input[type="image"]'

const targetOf = (target: EventTarget | undefined): KeyTarget => {
  const open = layerOpen()
  if (!(target instanceof HTMLElement))
    return { editing: false, arrowWidget: false, nativeEnter: false, layerOpen: open }
  const input = target instanceof HTMLInputElement ? target.type : undefined
  const role = target.getAttribute('role') ?? ''
  return {
    editing: isTextEntry(target) || target.tagName === 'SELECT',
    lineField: isLineField(target) && role !== 'combobox',
    // A focused scrolling box (logs, jobs) scrolls with the arrows.
    arrowWidget: arrowRoles.includes(role) || isScroller(target),
    rowWidget: input === 'range' || input === 'radio' || role === 'slider',
    nativeEnter: target.matches(nativeEnter),
    layerOpen: open,
    inForm: (target.closest('form, dialog, [role="dialog"]') ?? undefined) !== undefined,
  }
}

export const useSpatialNavigation = () => {
  const router = useRouter()

  useEffect(() => {
    const releaseBack = bindBack(() => {
      if (!canGoBackFrom(router.state.location.pathname, router.history.canGoBack())) return false
      router.history.back()
      return true
    })
    const stopNavigate = router.subscribe('onBeforeNavigate', ({ fromLocation, toLocation }) => {
      if (fromLocation?.pathname !== toLocation.pathname) forgetRows()
    })

    // After a pointer press the arrows scroll the page as they always did,
    // until a key other than an arrow (Tab, Enter…) hands the page to the keyboard.
    let pointerLast = false
    const onPointer = () => {
      pointerLast = true
    }

    const onKey = (event: KeyboardEvent) => {
      if (intentsClaimed()) return
      const arrow = directionOfKey(event.key) !== undefined
      if (!arrow) pointerLast = false
      if (arrow && pointerLast) return
      const intent = intentOfKey(event, targetOf(event.target ?? undefined))
      if (intent === undefined) return
      const handled = dispatchIntent(intent)
      // A back key is taken even when there is nowhere to go: the browser would
      // leave the app (`BrowserBack`) or go back twice.
      if (handled || (intent.kind === 'back' && backKeys.includes(event.key)))
        event.preventDefault()
    }
    // One Tab stop per row, set when Tab is about to use it (nothing runs for touch).
    const onTab = (event: KeyboardEvent) => {
      if (event.key === 'Tab') updateRovingRows()
    }

    const onFocusIn = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement)) return
      rememberFocus(event.target)
      const row = event.target.closest<HTMLElement>('[data-nav-roving]') ?? undefined
      if (row !== undefined) updateRovingRow(row)
    }

    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onTab, true)
    document.addEventListener('keydown', onKey)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      releaseBack()
      stopNavigate()
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('keydown', onTab, true)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('focusin', onFocusIn)
    }
  }, [router])
}
