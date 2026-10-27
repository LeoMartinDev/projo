import type { AppError, Result } from '@projo/shared'

import type { VisibilityScope } from '../catalog/catalog.ts'
import type { MediaError } from '../media/probe.ts'

/**
 * Files derived from a source and cached under `/data/cache` (§5.4): WebVTT subtitles (§10.4),
 * trickplay sprites (§10.5), hero previews (§13.3). Each records the size and mtime of what it
 * was built from: a changed file invalidates it.
 */

/** Size and mtime (`mtimeMs`, compared strictly) of the file an asset was built from. */
export type FileFingerprint = { sizeBytes: number; mtimeMs: number }

export const sameFingerprint = (a: FileFingerprint, b: FileFingerprint): boolean =>
  a.sizeBytes === b.sizeBytes && a.mtimeMs === b.mtimeMs

// ── Subtitles (§10.4) ────────────────────────────────────────────────────────

/** Text formats sent as WebVTT (`source_subtitles.format`, normalized by the scanner). */
const textSubtitleFormats: ReadonlySet<string> = new Set(['srt', 'ass', 'ssa', 'vtt', 'mov_text'])

export const isTextSubtitle = (format: string): boolean => textSubtitleFormats.has(format)

/** What a track is converted from: an external file, or a stream of the video file. */
export type SubtitleInput =
  | { kind: 'external'; path: string; format: string }
  | { kind: 'embedded'; path: string; streamIndex: number }

export type SubtitleCacheError = AppError<'playback/source_unavailable'> | MediaError

/** `/data/cache/subtitles/<source>/<track>.vtt`. */
export type SubtitleCache = {
  /**
   * Path of the WebVTT of a track, converted first when missing or built from another version
   * of its input. Concurrent calls for a track share one conversion.
   */
  ensure: (input: {
    sourceId: string
    trackId: string
    input: SubtitleInput
    signal?: AbortSignal
  }) => Promise<Result<string, SubtitleCacheError>>
  /** Several embedded tracks of one file in a single ffmpeg pass (pre-extraction, §7.1). */
  ensureEmbedded: (input: {
    sourceId: string
    path: string
    tracks: readonly { trackId: string; streamIndex: number }[]
    signal?: AbortSignal
  }) => Promise<Result<void, SubtitleCacheError>>
  /** Folder and file names that are valid ids only (anything else is not the cache's). */
  listSourceIds: () => string[]
  listTrackIds: (sourceId: string) => string[]
  /** One track, or the whole folder of the source. */
  remove: (input: { sourceId: string; trackId?: string }) => void
  /** Temporary files a crash left behind, last modified before `olderThan`; how many removed. */
  removeStaleTemporaries: (olderThan: Date) => number
}

// ── Trickplay (§10.5, §24: 1 image / 10 s, 320 px, 10×10 sheets) ────────────

export const trickplaySpec = { intervalS: 10, width: 320, columns: 10, rows: 10 } as const

/** `trickplayIndexDtoSchema`: thumbnail `i` is on sheet `floor(i / (columns × rows))`. */
export type TrickplayIndex = {
  interval: number
  width: number
  height: number
  columns: number
  rows: number
  sheets: number[]
}

/**
 * Thumbnail height for a 320 px width (`scale=320:-2`: even, aspect kept). 16:9 when the
 * dimensions are unknown.
 */
export const trickplayHeight = (video: { width?: number; height?: number }): number => {
  const { width, height } = video
  if (width === undefined || height === undefined || width <= 0 || height <= 0) return 180
  return Math.max(2, Math.round((trickplaySpec.width * height) / width / 2) * 2)
}

/**
 * The instant (s) of the thumbnail nearest to stream second `seconds`: thumbnail `i` stands for
 * `i × interval`, the last one for the last started interval of a `durationS` stream (past the
 * end: that one). `undefined` when the index has no sheet. Same rounding as the player's
 * `thumbnailAt` (the web).
 */
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
  /** The index and what it was built from, when the sprites exist. */
  read: (sourceId: string) => { index: TrickplayIndex; fingerprint: FileFingerprint } | undefined
  /** Builds the sprites in a temporary folder, then swaps it in (a reader never sees half). */
  generate: (input: {
    sourceId: string
    path: string
    videoStreamIndex: number
    height: number
    /** Probed duration of the file: one thumbnail per started interval of it. */
    durationMs: number
    fingerprint: FileFingerprint
    signal?: AbortSignal
  }) => Promise<Result<TrickplayIndex, MediaError>>
  /** Absolute path of a sheet that exists. */
  sheetPath: (input: { sourceId: string; sheet: number }) => string | undefined
  /**
   * Absolute path of a 640 px still of the video's frame at `second`, extracted on the first call
   * and kept with the sprites (gone when they are rebuilt); `undefined` when they do not exist.
   */
  framePath: (input: {
    sourceId: string
    path: string
    videoStreamIndex: number
    second: number
  }) => Promise<Result<string | undefined, MediaError>>
  /** Folder names that are valid ids only. */
  listSourceIds: () => string[]
  remove: (sourceId: string) => void
  /** Temporary folders a crash left behind, last modified before `olderThan`. */
  removeStaleTemporaries: (olderThan: Date) => number
}

// ── Hero preview (§13.3, §24: 20 s from 25 %, 720p) ─────────────────────────

export const previewSpec = { durationS: 20, startRatio: 0.25, maxHeight: 720 } as const

/** Where the clip is cut: 20 s from 25 % of the duration, kept inside the file. */
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
  /** The movie, or the episode the clip of a series was cut from. */
  sourceId: string
  fingerprint: FileFingerprint
  path: string
}

/** `/data/cache/previews/<item>.mp4` (+ what it was cut from). */
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
  /** File names that are valid ids only. */
  listItemIds: () => string[]
  remove: (itemId: string) => void
  /** Temporary clips a crash left behind, last modified before `olderThan`. */
  removeStaleTemporaries: (olderThan: Date) => number
}

// ── Database side ────────────────────────────────────────────────────────────

/** Read side of the database the derived files need (sources, libraries, items). */
export type MediaAssetCatalog = {
  /**
   * The source is ready and plays an item the scope sees (§14: library access, maximum rating):
   * the same rule as `listReadySources` of that item.
   */
  isSourceVisible: (input: { sourceId: string; scope: VisibilityScope }) => boolean
  /** Per-library switches (§6.2) of the source's library. */
  libraryFlags: (
    sourceId: string,
  ) => { preExtractSubtitles: boolean; trickplayEnabled: boolean } | undefined
  /**
   * Ready sources of the libraries with `trickplay_enabled` (backfill). `inProgress`: a profile
   * has its item in "Continue watching" (started, not watched, not hidden), whose card shows
   * the resume frame from these sprites.
   */
  listTrickplayCandidates: () => {
    id: string
    fingerprint: FileFingerprint
    inProgress: boolean
  }[]
  /** The ids among `ids` that still exist (sources, subtitle tracks, items). */
  existingSourceIds: (ids: readonly string[]) => Set<string>
  existingTrackIds: (ids: readonly string[]) => Set<string>
  existingItemIds: (ids: readonly string[]) => Set<string>
  /** What has a preview (§13.3): a movie, or the series of an episode or a season. */
  previewTargetOf: (itemId: string) => { id: string; kind: 'movie' | 'series' } | undefined
}
