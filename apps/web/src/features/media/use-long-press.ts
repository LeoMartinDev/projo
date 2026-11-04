import { type MouseEvent, type PointerEvent, useRef } from 'react'

const holdMs = 480
const slopPx = 10

export const useLongPress = (onLongPress: (element: HTMLElement) => void) => {
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
      const element = event.currentTarget
      origin.current = { x: event.clientX, y: event.clientY }
      timer.current = setTimeout(() => {
        fired.current = true
        cancel()
        if ('vibrate' in navigator) navigator.vibrate(8)
        onLongPress(element)
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
      event.preventDefault()
      if (origin.current !== undefined || fired.current) return
      onLongPress(event.currentTarget)
    },
    onClickCapture: (event: MouseEvent<HTMLElement>) => {
      if (!fired.current) return
      fired.current = false
      event.preventDefault()
      event.stopPropagation()
    },
  }
}
