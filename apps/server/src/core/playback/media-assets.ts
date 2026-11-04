import type { AppError, Result } from '@projo/shared'

import type { VisibilityScope } from '../catalog/catalog.ts'
import type { MediaError } from '../media/probe.ts'

export type FileFingerprint = { sizeBytes: number; mtimeMs: number }

export const sameFingerprint = (a: FileFingerprint, b: FileFingerprint): boolean =>
  a.sizeBytes === b.sizeBytes && a.mtimeMs === b.mtimeMs

const textSubtitleFormats: ReadonlySet<string> = new Set(['srt', 'ass', 'ssa', 'vtt', 'mov_text'])

export const isTextSubtitle = (format: string): boolean => textSubtitleFormats.has(format)

export type SubtitleInput =
  | { kind: 'external'; path: string; format: string }
  | { kind: 'embedded'; path: string; streamIndex: number }

export type SubtitleCacheError = AppError<'playback/source_unavailable'> | MediaError

export type SubtitleCache = {
  ensure: (input: {
    sourceId: string
    trackId: string
    input: SubtitleInput
    signal?: AbortSignal
  }) => Promise<Result<string, SubtitleCacheError>>
  ensureEmbedded: (input: {
    sourceId: string
    path: string
    tracks: readonly { trackId: string; streamIndex: number }[]
    signal?: AbortSignal
  }) => Promise<Result<void, SubtitleCacheError>>
  listSourceIds: () => string[]
  listTrackIds: (sourceId: string) => string[]
  remove: (input: { sourceId: string; trackId?: string }) => void
  removeStaleTemporaries: (olderThan: Date) => number
}

export const trickplaySpec = { intervalS: 10, width: 320, columns: 10, rows: 10 } as const

export type TrickplayIndex = {
  interval: number
  width: number
  height: number
  columns: number
  rows: number
  sheets: number[]
}

export const trickplayHeight = (video: { width?: number; height?: number }): number => {
  const { width, height } = video
  if (width === undefined || height === undefined || width <= 0 || height <= 0) return 180
  return Math.max(2, Math.round((trickplaySpec.width * height) / width / 2) * 2)
}

export const trickplayInstantAt = (
  index: TrickplayIndex,
  seconds: number,
  durationS: number,
): number | undefined => {
  if (index.sheets.length === 0 || index.interval <= 0) return undefined
  const last = Math.max(0, Math.ceil(durationS / index.interval) - 1)
  return Math.min(Math.round(Math.max(0, seconds) / index.interval), last) * index.interval
}

export type TrickplayStore = {
  read: (sourceId: string) => { index: TrickplayIndex; fingerprint: FileFingerprint } | undefined
  generate: (input: {
    sourceId: string
    path: string
    videoStreamIndex: number
    height: number
    durationMs: number
    fingerprint: FileFingerprint
    signal?: AbortSignal
  }) => Promise<Result<TrickplayIndex, MediaError>>
  sheetPath: (input: { sourceId: string; sheet: number }) => string | undefined
  framePath: (input: {
    sourceId: string
    path: string
    videoStreamIndex: number
    second: number
  }) => Promise<Result<string | undefined, MediaError>>
  listSourceIds: () => string[]
  remove: (sourceId: string) => void
  removeStaleTemporaries: (olderThan: Date) => number
}

export const previewSpec = { durationS: 20, startRatio: 0.25, maxHeight: 720 } as const

export const previewWindow = (durationMs: number): { startS: number; durationS: number } => {
  const totalS = Math.max(0, durationMs / 1000)
  const durationS = Math.min(previewSpec.durationS, totalS)
  const startS = Math.min(totalS * previewSpec.startRatio, Math.max(0, totalS - durationS))
  return {
    startS: Math.round(startS * 1000) / 1000,
    durationS: Math.round(durationS * 1000) / 1000,
  }
}

export type StoredPreview = {
  sourceId: string
  fingerprint: FileFingerprint
  path: string
}

export type PreviewStore = {
  read: (itemId: string) => StoredPreview | undefined
  generate: (input: {
    itemId: string
    sourceId: string
    path: string
    videoStreamIndex: number
    audioStreamIndex?: number
    startS: number
    durationS: number
    fingerprint: FileFingerprint
    signal?: AbortSignal
  }) => Promise<Result<void, MediaError>>
  listItemIds: () => string[]
  remove: (itemId: string) => void
  removeStaleTemporaries: (olderThan: Date) => number
}

export type MediaAssetCatalog = {
  isSourceVisible: (input: { sourceId: string; scope: VisibilityScope }) => boolean
  libraryFlags: (
    sourceId: string,
  ) => { preExtractSubtitles: boolean; trickplayEnabled: boolean } | undefined
  listTrickplayCandidates: () => {
    id: string
    fingerprint: FileFingerprint
    inProgress: boolean
  }[]
  existingSourceIds: (ids: readonly string[]) => Set<string>
  existingTrackIds: (ids: readonly string[]) => Set<string>
  existingItemIds: (ids: readonly string[]) => Set<string>
  previewTargetOf: (itemId: string) => { id: string; kind: 'movie' | 'series' } | undefined
}
