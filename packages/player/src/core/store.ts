export type ReadableStore<T> = {
  subscribe: (notify: () => void) => () => void
  get: () => T
}

export type Store<T> = ReadableStore<T> & { set: (value: T) => void }

// A value with listeners; `set` notifies only when the value changes (by identity).
export const createStore = <T>(initial: T): Store<T> => {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    subscribe: (notify) => {
      listeners.add(notify)
      return () => {
        listeners.delete(notify)
      }
    },
    get: () => value,
    set: (next) => {
      if (Object.is(next, value)) return
      value = next
      for (const notify of [...listeners]) notify()
    },
  }
}
