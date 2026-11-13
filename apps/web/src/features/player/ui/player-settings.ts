import { readStoredJson, writeStoredJson } from '../../shared/storage/local-store.ts'
import { clampDelay, isSubtitleSize, type SubtitleSize } from './subtitles.ts'

export type SubtitleSettings = { size: SubtitleSize; delayMs: number }

export const defaultSubtitleSettings: SubtitleSettings = { size: 'medium', delayMs: 0 }

const key = 'projo.player.subtitles'

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

export const playbackRates = [0.5, 1, 1.5, 2] as const

const minRate = playbackRates[0]
const maxRate = playbackRates[playbackRates.length - 1] ?? 2
const dragGive = 0.35

export const ratioOfRate = (rate: number): number =>
  Math.min(1, Math.max(0, (rate - minRate) / (maxRate - minRate)))

export const rateAtRatio = (ratio: number): number => {
  const raw = minRate + Math.min(1, Math.max(0, ratio)) * (maxRate - minRate)
  return playbackRates.reduce((best, rate) =>
    Math.abs(rate - raw) < Math.abs(best - raw) ? rate : best,
  )
}

export const thumbRatioWhileDragging = (ratio: number): number => {
  const clamped = Math.min(1, Math.max(0, ratio))
  const step = ratioOfRate(rateAtRatio(clamped))
  return step + (clamped - step) * dragGive
}

export const rateStepFrom = (rate: number, direction: 1 | -1): number =>
  direction === 1
    ? (playbackRates.find((step) => step > rate) ?? maxRate)
    : (playbackRates.findLast((step) => step < rate) ?? minRate)
