import { type ReactNode, useEffect } from 'react'

import { useElement } from './use-element.ts'
import './sheet.css'

/**
 * Bottom sheet of artboard `MobileHome` (long press on a card, catalog filters): a native modal
 * `<dialog>` (focus trap, Escape) that slides up from the bottom edge; a tap outside closes it.
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

  useEffect(() => {
    if (dialog === undefined) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [dialog, open])

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={labelledBy}
      onClose={onClose}
      onCancel={(event) => {
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
