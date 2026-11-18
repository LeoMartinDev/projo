const unset = Symbol('unset')

// A side effect keyed by a value, like a React effect: started when the key
// changes, the previous one cleaned up first.
export const keyedEffect = () => {
  let key: unknown = unset
  let cleanup: (() => void) | undefined
  return {
    sync: (next: unknown, start: () => (() => void) | undefined) => {
      if (Object.is(next, key)) return
      key = next
      const previous = cleanup
      cleanup = undefined
      previous?.()
      cleanup = start()
    },
    reset: () => {
      key = unset
      const previous = cleanup
      cleanup = undefined
      previous?.()
    },
  }
}
