import { type ReactNode, useEffect, useEffectEvent } from 'react'

import { reducedMotion } from '../styles/media.ts'
import { useElement } from './use-element.ts'
import './sheet.css'

const dismissDistance = 80

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
  const dismiss = useEffectEvent(() => onClose())

  useEffect(() => {
    if (dialog === undefined) return
    if (open && !dialog.open) {
      dialog.showModal()
      dialog.focus()
    }
    if (!open && dialog.open) {
      dialog.close()
      dialog.style.removeProperty('translate')
    }
  }, [dialog, open])

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
      if (dialog.scrollTop > 0 || y < startY) startY = y
      offset = y - startY
      if (offset > 0) event.preventDefault()
      dialog.style.translate = `0 ${offset}px`
    }
    const onEnd = () => {
      dialog.style.removeProperty('transition')
      if (offset < dismissDistance) return dialog.style.removeProperty('translate')
      if (matchMedia(reducedMotion).matches) return dismiss()
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
      onClose={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
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
