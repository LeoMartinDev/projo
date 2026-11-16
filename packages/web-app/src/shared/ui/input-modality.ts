import { useEffect } from 'react'

import { isTextEntry } from './focusable.ts'

// How the user is driving the page (§19): with the keyboard or a pointer. A
// focus that arrives while the keyboard drives is a keyboard focus; the strong
// ring of a field that is always `:focus-visible` (a text input) follows it
// through `<html data-modality>`.

export type InputModality = 'keyboard' | 'pointer'

const modifiers = ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'AltGraph']

/** The modality after a key: unchanged by modifiers, shortcuts, or typing into a field. */
export const modalityAfterKey = (
  current: InputModality,
  key: {
    key: string
    ctrlKey: boolean
    metaKey: boolean
    altKey: boolean
    editing: boolean
  },
): InputModality => {
  if (modifiers.includes(key.key) || key.ctrlKey || key.metaKey || key.altKey) return current
  const typing = key.key.length === 1 || key.key === 'Backspace' || key.key === 'Delete'
  return key.editing && typing ? current : 'keyboard'
}

let modality: InputModality = 'pointer'

export const currentModality = (): InputModality => modality

const show = (next: InputModality) => {
  modality = next
  document.documentElement.dataset['modality'] = next
}

/** Input that drives like the keyboard without keys (a gamepad). */
export const showKeyboardModality = () => {
  if (modality !== 'keyboard') show('keyboard')
}

/** Follows the modality for the whole document while mounted (the root route). */
export const useInputModality = () => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) =>
      show(
        modalityAfterKey(modality, {
          key: event.key,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
          editing: isTextEntry(event.target ?? undefined),
        }),
      )
    const onPointer = () => show('pointer')
    show(modality)
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onPointer, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onPointer, true)
    }
  }, [])
}
