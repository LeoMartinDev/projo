/**
 * Per-device preferences in `localStorage`. Storage can be missing or throw (private browsing,
 * quota, disabled cookies): reads fall back to `undefined`, writes are dropped.
 */
export const readStored = (key: string): string | undefined => {
  try {
    return globalThis.localStorage?.getItem(key) ?? undefined
  } catch {
    return undefined
  }
}

export const writeStored = (key: string, value: string): void => {
  try {
    globalThis.localStorage?.setItem(key, value)
  } catch {
    // Storage unavailable: the preference only lasts for this page.
  }
}

/** JSON value, validated by `parse` (anything unreadable is `undefined`). */
export const readStoredJson = <T>(key: string, parse: (value: unknown) => T): T | undefined => {
  const raw = readStored(key)
  if (raw === undefined) return undefined
  try {
    return parse(JSON.parse(raw) as unknown)
  } catch {
    return undefined
  }
}

export const writeStoredJson = (key: string, value: unknown): void =>
  writeStored(key, JSON.stringify(value))
