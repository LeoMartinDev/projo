import { type RefCallback, useCallback, useState } from 'react'

/**
 * A DOM element held in state, set by a stable callback ref. Replaces `useRef(null)`, which §5.3
 * bans (no `null`); having the element in state also re-runs effects that depend on it.
 */
export const useElement = <T extends Element>(): readonly [T | undefined, RefCallback<T>] => {
  const [element, setElement] = useState<T>()
  const ref: RefCallback<T> = useCallback((node) => setElement(node ?? undefined), [])
  return [element, ref] as const
}
