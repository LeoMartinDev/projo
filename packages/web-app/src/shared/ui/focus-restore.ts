// Focus across navigations (§19), the pure part: which way a navigation went,
// and which element each history entry was left from.

export type NavigationEntry = {
  pathname: string
  // The history entry's position (`__TSR_index` of TanStack's history state).
  index?: number | undefined
}

export type NavigationKind = 'forward' | 'back' | 'none'

/** Back when the history index went down; forward to another path; otherwise none. */
export const navigationKind = (
  from: NavigationEntry | undefined,
  to: NavigationEntry,
): NavigationKind => {
  if (from === undefined) return 'none'
  if (from.index !== undefined && to.index !== undefined && to.index < from.index) return 'back'
  return from.pathname === to.pathname ? 'none' : 'forward'
}

/** Where the element of a focus key is found again: an explicit key, or a link's href. */
export type FocusKey = { kind: 'key'; value: string } | { kind: 'href'; value: string }

export const focusKeyOf = (element: {
  focusKey?: string | undefined
  href?: string | undefined
}): FocusKey | undefined =>
  element.focusKey !== undefined && element.focusKey !== ''
    ? { kind: 'key', value: element.focusKey }
    : element.href !== undefined && element.href !== ''
      ? { kind: 'href', value: element.href }
      : undefined

/** The focus key each history entry was left from, for the last `limit` entries. */
export const createFocusMemory = (limit = 100) => {
  const keys = new Map<string, FocusKey>()
  return {
    remember: (entry: string, key: FocusKey | undefined) => {
      keys.delete(entry)
      if (key === undefined) return
      keys.set(entry, key)
      const oldest = keys.keys().next()
      if (keys.size > limit && oldest.done !== true) keys.delete(oldest.value)
    },
    recall: (entry: string) => keys.get(entry),
  }
}
