import { useEffect } from 'react'

import { showKeyboardModality } from '../input-modality.ts'
import { dispatchIntent } from '../spatial-nav/intents.ts'
import { initialPadState, type PadSnapshot, readPads, resumePads } from './gamepad.ts'

// The gamepad adapter of the intent layer (§19), mounted once by the root route
// next to the keyboard's: reads the pads on every frame while one is connected,
// the page shows and the window has focus (like the keyboard, §28.9), and sends
// their intents. Nothing runs where the Gamepad API is missing (it needs a
// secure context: plain-HTTP LAN access has none). Chromium reports a pad only
// once a button is pressed, so the pads are read once at mount and again on
// `gamepadconnected`; reading stops on `gamepaddisconnected` once none is left,
// never on a frame that lists none (a Bluetooth pad enumerated again).

const connectedPads = (): PadSnapshot[] =>
  [...navigator.getGamepads()]
    .filter((pad): pad is Gamepad => pad?.connected === true)
    .map((pad) => ({
      index: pad.index,
      standard: pad.mapping === 'standard',
      pressed: pad.buttons.map((button) => button.pressed),
      axes: [...pad.axes],
    }))

export const useGamepad = () => {
  useEffect(() => {
    if (typeof navigator.getGamepads !== 'function') return
    let state = initialPadState
    let frame: number | undefined
    let paused = false

    const tick = (now: number) => {
      if (paused) {
        state = resumePads(state, now)
        paused = false
      }
      const read = readPads(state, connectedPads(), now)
      state = read.state
      frame = requestAnimationFrame(tick)
      if (read.intents.length === 0) return
      // Focus rings and the player's keyboard focus follow the pad as they follow keys.
      showKeyboardModality()
      for (const intent of read.intents) dispatchIntent(intent)
    }

    const start = () => {
      if (frame !== undefined || document.visibilityState !== 'visible' || !document.hasFocus())
        return
      if (connectedPads().length > 0) frame = requestAnimationFrame(tick)
    }
    // What is held stays held; a held direction waits its delay again on return.
    const stop = () => {
      if (frame === undefined) return
      cancelAnimationFrame(frame)
      frame = undefined
      paused = true
    }
    const onDisconnected = () => {
      if (connectedPads().length > 0) return
      stop()
      state = initialPadState
      paused = false
    }
    const onVisibility = () => (document.visibilityState === 'visible' ? start() : stop())

    start()
    window.addEventListener('gamepadconnected', start)
    window.addEventListener('gamepaddisconnected', onDisconnected)
    window.addEventListener('focus', start)
    window.addEventListener('blur', stop)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      window.removeEventListener('gamepadconnected', start)
      window.removeEventListener('gamepaddisconnected', onDisconnected)
      window.removeEventListener('focus', start)
      window.removeEventListener('blur', stop)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])
}
