import { useEffect, useState } from 'react'

/** `value` once it has stopped changing for `delayMs` (a search typed letter by letter). */
export const useDebounced = <T>(value: T, delayMs: number): T => {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}
