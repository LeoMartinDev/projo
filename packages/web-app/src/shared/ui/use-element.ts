import { type RefCallback, useCallback, useState } from 'react'

export const useElement = <T extends Element>(): readonly [T | undefined, RefCallback<T>] => {
  const [element, setElement] = useState<T>()
  const ref: RefCallback<T> = useCallback((node) => setElement(node ?? undefined), [])
  return [element, ref] as const
}
