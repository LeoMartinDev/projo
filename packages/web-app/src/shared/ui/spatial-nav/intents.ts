import type { NavIntent } from './keys.ts'
import { activateFocus, moveFocus, topModal } from './spatial-nav.ts'

// The intent layer (§19): move, activate, back, sent by the keyboard adapter
// (use-spatial-navigation.ts) and by the gamepad adapter (gamepad/), which also
// sends a card's menu and playback. The page handles them, unless a screen
// claimed them: the player, which reads its own keys and turns intents into its
// commands.

export type IntentHandler = (intent: NavIntent) => boolean

let owners: readonly IntentHandler[] = []
let goBack: () => boolean = () => false

/** Takes every intent while held (the keyboard adapter then leaves the keys alone). */
export const claimIntents = (handler: IntentHandler) => {
  owners = [...owners, handler]
  return () => {
    owners = owners.filter((owner) => owner !== handler)
  }
}

export const intentsClaimed = () => owners.length > 0

/** How the app goes back (the router's history), bound once by the root route. */
export const bindBack = (handler: () => boolean) => {
  goBack = handler
  return () => {
    if (goBack === handler) goBack = () => false
  }
}

const popoversSupported = () => typeof HTMLElement.prototype.hidePopover === 'function'

/** The open popovers (account menu, a select's list). */
export const openPopovers = (): HTMLElement[] =>
  popoversSupported()
    ? [...document.querySelectorAll<HTMLElement>('[popover]')].filter((element) =>
        element.matches(':popover-open'),
      )
    : []

/** Whether a modal dialog or a popover is open: Escape closes it natively. */
export const layerOpen = () => topModal() !== undefined || openPopovers().length > 0

/** Closes the open popover, else the modal dialog on top, as Escape would. */
export const closeTopLayer = (): boolean => {
  const popover = openPopovers().at(-1)
  if (popover !== undefined) {
    popover.hidePopover()
    return true
  }
  const modal = topModal()
  if (modal === undefined) return false
  if (modal.dispatchEvent(new Event('cancel', { cancelable: true }))) modal.close()
  return true
}

/**
 * Opens the focused element's menu (a card's actions) as the context-menu key
 * does: a `contextmenu` event on it, which only the page's handlers see (an
 * untrusted event opens no browser menu). True when one took it.
 */
export const openFocusMenu = (): boolean => {
  const active = document.activeElement ?? undefined
  if (!(active instanceof HTMLElement) || active === document.body) return false
  const rect = active.getBoundingClientRect()
  return !active.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: (rect.left + rect.right) / 2,
      clientY: (rect.top + rect.bottom) / 2,
    }),
  )
}

/** What the page does with an intent: playback is the player's alone. */
export const pageIntent = (intent: NavIntent): boolean => {
  switch (intent.kind) {
    case 'move':
      return moveFocus(intent.direction)
    case 'activate':
      return activateFocus()
    case 'back':
      return closeTopLayer() || goBack()
    case 'menu':
      return openFocusMenu()
    case 'media':
      return false
  }
}

/** Sends an intent to the screen that claimed them, else to the page. True when handled. */
export const dispatchIntent = (intent: NavIntent): boolean => {
  const owner = owners.at(-1)
  return owner === undefined ? pageIntent(intent) : owner(intent)
}
