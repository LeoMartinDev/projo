import { readStoredJson, writeStoredJson } from '../../shared/storage/local-store.ts'
import { clampDelay, isSubtitleSize, type SubtitleSize } from './subtitles.ts'

/** Subtitle delay and size, remembered per device (§10.4) in `localStorage` (guarded). */
export type SubtitleSettings = { size: SubtitleSize; delayMs: number }

export const defaultSubtitleSettings: SubtitleSettings = { size: 'medium', delayMs: 0 }

const key = 'projo.player.subtitles'

/** Anything unreadable falls back to the defaults, field by field. */
export const parseSubtitleSettings = (value: unknown): SubtitleSettings => {
  const record =
    typeof value === 'object' && Object(value) === value ? (value as Record<string, unknown>) : {}
  const size = record['size']
  const delayMs = record['delayMs']
  return {
    size: isSubtitleSize(size) ? size : defaultSubtitleSettings.size,
    delayMs: typeof delayMs === 'number' ? clampDelay(delayMs) : defaultSubtitleSettings.delayMs,
  }
}

export const loadSubtitleSettings = (): SubtitleSettings =>
  readStoredJson(key, parseSubtitleSettings) ?? defaultSubtitleSettings

export const saveSubtitleSettings = (settings: SubtitleSettings): void =>
  writeStoredJson(key, settings)

/** Speeds of the menu (§10.7: 0,5× to 2×). */
export const playbackRates = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const
