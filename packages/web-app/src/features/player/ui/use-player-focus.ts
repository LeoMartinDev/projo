import { useEffect, useMemo, useRef } from 'react'

import { isUsable, tabbablesIn } from '../../../shared/ui/focusable.ts'
import { currentModality } from '../../../shared/ui/input-modality.ts'

// The control focus goes to: the first usable of `preferred`, else play/pause,
// else the first control.
const controlTarget = (container: HTMLElement, preferred: readonly (HTMLElement | undefined)[]) =>
  [...preferred, container.querySelector<HTMLElement>('.player__control--play') ?? undefined].find(
    isUsable,
  ) ?? tabbablesIn(container)[0]

/**
 * Keyboard focus in the player (§10.7, §19). Records which element got focus
 * while the keyboard drove (a click then a key makes Chromium's
 * `:focus-visible` match, so keydown cannot tell), wakes the chrome when one
 * does, and when that control disappears (a skip button once used, the "Next
 * episode" bubble, a menu closed by a switch) hands focus to its menu's
 * button, else to play/pause, instead of letting it fall to the page.
 *
 * Once the chrome fades, that focus rests: the arrows seek again and Enter
 * wakes the controls (`focusControls`), until the keyboard moves focus again.
 */
export const usePlayerFocus = (container: HTMLElement | undefined, onKeyboardFocus: () => void) => {
  const keyboardFocus = useRef<HTMLElement | undefined>(undefined)
  const resting = useRef(false)
  const wake = useRef(onKeyboardFocus)
  useEffect(() => {
    wake.current = onKeyboardFocus
  }, [onKeyboardFocus])

  useEffect(() => {
    if (container === undefined) return

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target
      const keyboard = target instanceof HTMLElement && currentModality() === 'keyboard'
      keyboardFocus.current = keyboard ? target : undefined
      resting.current = false
      if (keyboard) wake.current()
    }
    const rescue = (lost: HTMLElement) => {
      const menu = lost.closest<HTMLElement>('[data-overlay]')?.dataset['overlay']
      const opener =
        menu === undefined
          ? undefined
          : (container.querySelector<HTMLElement>(`[data-menu="${menu}"]`) ?? undefined)
      controlTarget(container, [opener])?.focus({ preventScroll: true })
    }
    const observer = new MutationObserver(() => {
      const lost = keyboardFocus.current
      if (lost === undefined || lost.isConnected) return
      keyboardFocus.current = undefined
      const active = document.activeElement ?? undefined
      if (active === undefined || active === document.body) rescue(lost)
    })

    container.addEventListener('focusin', onFocusIn)
    observer.observe(container, { childList: true, subtree: true })
    return () => {
      container.removeEventListener('focusin', onFocusIn)
      observer.disconnect()
    }
  }, [container])

  return useMemo(
    () => ({
      /** Whether `element` has focus from the keyboard (not from a click followed by a key). */
      isKeyboardFocused: (element: EventTarget | undefined) =>
        !resting.current &&
        element !== undefined &&
        element === keyboardFocus.current &&
        element === document.activeElement,
      /** The chrome faded: the focused control no longer takes the keys. */
      rest: () => {
        resting.current = true
      },
      /**
       * Enter: keyboard focus on the main button of an end or error overlay,
       * else on play/pause, even when it already had focus (from a click).
       */
      focusControls: () => {
        if (container === undefined) return
        const overlay =
          container.querySelector<HTMLElement>('.player__overlay .button--primary') ?? undefined
        const target = controlTarget(container, [overlay])
        if (target === undefined) return
        target.focus({ preventScroll: true })
        // Set here too: focusing what already has focus (from a click) fires no focusin.
        keyboardFocus.current = target
        resting.current = false
        wake.current()
      },
      /** Escape: focus leaves the controls (§10.7). */
      release: () => {
        const active = document.activeElement ?? undefined
        keyboardFocus.current = undefined
        if (active instanceof HTMLElement && container?.contains(active) === true) active.blur()
      },
    }),
    [container],
  )
}
