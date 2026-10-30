import { type ReactNode, useEffect, useEffectEvent } from 'react'

import { reducedMotion } from '../styles/media.ts'
import { useElement } from './use-element.ts'
import './sheet.css'

/** Drag past which releasing the sheet dismisses it. */
const dismissDistance = 80

/**
 * Bottom sheet of artboard `MobileHome` (long press on a card, catalog filters): a native modal
 * `<dialog>` (focus trap, Escape) that slides up from the bottom edge; a tap outside or a drag
 * down from its top closes it.
 */
export const Sheet = ({
  open,
  labelledBy,
  onClose,
  children,
}: {
  open: boolean
  labelledBy: string
  onClose: () => void
  children: ReactNode
}) => {
  const [dialog, ref] = useElement<HTMLDialogElement>()
  // The touch listeners outlive renders (a refetch during a drag) yet call the latest onClose.
  const dismiss = useEffectEvent(() => onClose())

  useEffect(() => {
    if (dialog === undefined) return
    if (open && !dialog.open) {
      dialog.showModal()
      // Focus the sheet, not its first button: Safari draws the focus ring on that button even
      // after a touch. Tab still reaches it.
      dialog.focus()
    }
    if (!open && dialog.open) {
      dialog.close()
      dialog.style.removeProperty('translate')
    }
  }, [dialog, open])

  // A <dialog> has no native swipe: the sheet follows a finger dragging down from its top.
  useEffect(() => {
    if (dialog === undefined) return
    let startY = 0
    let offset = 0
    const onStart = (event: TouchEvent) => {
      startY = event.touches[0]?.clientY ?? 0
      offset = 0
      dialog.style.transition = 'none'
    }
    const onMove = (event: TouchEvent) => {
      const y = event.touches[0]?.clientY
      if (y === undefined) return
      // Scrolled content scrolls back first; the drag starts once it is at the top.
      if (dialog.scrollTop > 0 || y < startY) startY = y
      offset = y - startY
      if (offset > 0) event.preventDefault()
      dialog.style.translate = `0 ${offset}px`
    }
    const onEnd = () => {
      dialog.style.removeProperty('transition')
      if (offset < dismissDistance) return dialog.style.removeProperty('translate')
      if (matchMedia(reducedMotion).matches) return dismiss()
      // Past its own height and the 8 px it floats above the edge (sheet.css).
      dialog.style.translate = '0 calc(100% + 8px)'
    }
    const onSlidOut = (event: TransitionEvent) => {
      if (
        event.target === dialog &&
        event.propertyName === 'translate' &&
        offset >= dismissDistance
      )
        dismiss()
    }
    dialog.addEventListener('touchstart', onStart, { passive: true })
    dialog.addEventListener('touchmove', onMove, { passive: false })
    dialog.addEventListener('touchend', onEnd)
    dialog.addEventListener('touchcancel', onEnd)
    dialog.addEventListener('transitionend', onSlidOut)
    return () => {
      dialog.removeEventListener('touchstart', onStart)
      dialog.removeEventListener('touchmove', onMove)
      dialog.removeEventListener('touchend', onEnd)
      dialog.removeEventListener('touchcancel', onEnd)
      dialog.removeEventListener('transitionend', onSlidOut)
    }
  }, [dialog])

  return (
    <dialog
      ref={ref}
      className="sheet"
      tabIndex={-1}
      aria-labelledby={labelledBy}
      // React propagates cancel and close up the tree: ignore those of a nested dialog.
      onClose={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        // A click on the dialog itself (not its content) is a click on the backdrop.
        if (event.target === event.currentTarget) onClose()
      }}
    >
      {open ? (
        <div className="sheet__body">
          <span className="sheet__grip" aria-hidden="true" />
          {children}
        </div>
      ) : undefined}
    </dialog>
  )
}
