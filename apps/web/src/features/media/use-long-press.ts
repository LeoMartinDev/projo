import { type MouseEvent, type PointerEvent, useRef } from 'react'

const holdMs = 480
const slopPx = 10

/**
 * Long press on a touch screen (artboard `MobileHome`: "long press for the actions"). The click
 * that ends a long press is swallowed so the card does not also open; the system menu of a long
 * press on a link is suppressed. Mouse and pen keep their normal behaviour.
 */
export const useLongPress = (onLongPress: () => void) => {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const origin = useRef<{ x: number; y: number }>(undefined)
  const fired = useRef(false)

  const cancel = () => {
    clearTimeout(timer.current)
    timer.current = undefined
    origin.current = undefined
  }

  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      fired.current = false
      if (event.pointerType !== 'touch') return
      origin.current = { x: event.clientX, y: event.clientY }
      timer.current = setTimeout(() => {
        fired.current = true
        cancel()
        if ('vibrate' in navigator) navigator.vibrate(8)
        onLongPress()
      }, holdMs)
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const start = origin.current
      if (start === undefined) return
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > slopPx) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      if (origin.current !== undefined || fired.current) event.preventDefault()
    },
    onClickCapture: (event: MouseEvent<HTMLElement>) => {
      if (!fired.current) return
      fired.current = false
      event.preventDefault()
      event.stopPropagation()
    },
  }
}
