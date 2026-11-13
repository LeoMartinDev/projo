import type { KeyValueStorage } from './ports.ts'

// The volume is remembered per device (§10.7).
export const volumeKey = 'projo.player.volume'

export type SavedVolume = { volume: number; muted: boolean }

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export const loadVolume = (storage: KeyValueStorage): SavedVolume => {
  const parsed = parse(storage.get(volumeKey) ?? '{}')
  const record =
    typeof parsed === 'object' && Object(parsed) === parsed
      ? (parsed as Record<string, unknown>)
      : {}
  const volume = record['volume']
  return {
    volume: typeof volume === 'number' && volume >= 0 && volume <= 1 ? volume : 1,
    muted: record['muted'] === true,
  }
}

export const saveVolume = (storage: KeyValueStorage, volume: number, muted: boolean): void =>
  storage.set(volumeKey, JSON.stringify({ volume, muted }))
