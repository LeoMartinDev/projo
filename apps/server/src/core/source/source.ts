import type { ReviewReason } from '@projo/shared/api/metadata'

import type { MediaProbe, EmbeddedSubtitle } from '../media/probe.ts'
import type { Classification, ParsedName } from '../naming/index.ts'

export type SourceState = 'pending' | 'ready' | 'missing' | 'rejected'
export type PendingReason = 'growing' | 'probe_failed' | 'decode_failed' | 'too_small'
export type MatchState = 'unmatched' | 'matched' | 'manual' | 'needs_review'

/** What the scanner compares with the disk (§7.4–7.6). No probe: cheap to load for a whole library. */
export type SourceSnapshot = {
  id: string
  libraryId: string
  rootId: string
  relativePath: string
  state: SourceState
  pendingReason?: PendingReason
  sizeBytes: number
  mtimeMs: number
  inode?: string
  readyAt?: Date
  signature?: string
  classification: Classification
  parsed: ParsedName
  matchState: MatchState
  stackGroupId?: string
  partIndex?: number
}

export type Source = SourceSnapshot & {
  extension: string
  discoveredAt: Date
  /** Since when the source is `pending` (stuck notification after 24 h, §7.3 step 5). */
  pendingSince?: Date
  /** Since when (size, mtime) has been observed unchanged: the quiet-period counter (§7.3 step 3). */
  unchangedSince?: Date
  /** Set once the quiet period is over (§7.3 step 3). */
  stableSince?: Date
  missingSince?: Date
  probe?: MediaProbe
  reviewReason?: ReviewReason
}

/** Columns a scan or a job may write. A key set to `undefined` clears the column; an absent key leaves it. */
export type SourcePatch = {
  rootId?: string
  relativePath?: string
  extension?: string
  state?: SourceState
  pendingReason?: PendingReason | undefined
  sizeBytes?: number
  mtimeMs?: number
  inode?: string | undefined
  pendingSince?: Date | undefined
  unchangedSince?: Date | undefined
  stableSince?: Date | undefined
  readyAt?: Date | undefined
  missingSince?: Date | undefined
  probe?: MediaProbe | undefined
  signature?: string | undefined
  classification?: Classification
  parsed?: ParsedName
  matchState?: MatchState
  reviewReason?: ReviewReason | undefined
  stackGroupId?: string | undefined
  partIndex?: number | undefined
}

export type NewSource = {
  id: string
  libraryId: string
  rootId: string
  relativePath: string
  extension: string
  sizeBytes: number
  mtimeMs: number
  inode?: string
  discoveredAt: Date
  classification: Classification
  parsed: ParsedName
  matchState: MatchState
  reviewReason?: ReviewReason
}

/** A pending source with what `watch_pending` needs (§7.3 step 3). */
export type PendingSourceView = {
  id: string
  libraryId: string
  rootPath: string
  relativePath: string
  pendingReason: PendingReason
  sizeBytes: number
  mtimeMs: number
  pendingSince?: Date
  unchangedSince?: Date
  stableSince?: Date
  quietPeriodSeconds: number
}

export type ExternalSubtitleRow = {
  /** Absolute path of the subtitle file (`.idx` for VobSub). */
  path: string
  language?: string
  forced: boolean
  sdh: boolean
  isDefault: boolean
  format: string
  title?: string
}

export type SourceCounts = Record<SourceState, number>

/**
 * Where the pending sources of a library stand in the §7.2–7.3 pipeline, sources of unreachable
 * roots left out (nothing moves there until the root is back):
 * - `waiting`: `growing`, quiet period running (`stable_since` not set yet);
 * - `verifying`: `growing` and stable, `probe_source` (probe + sample decodes) queued or running;
 * - `failed`: `probe_failed`, `decode_failed` or `too_small`, they only move when the file changes
 *   (or when a scan or an admin re-tests them).
 * `earliestUnchangedSince`: oldest quiet-period counter among the waiting sources.
 */
export type PendingBreakdown = {
  waiting: number
  verifying: number
  failed: number
  earliestUnchangedSince?: Date
}

/** An item a source is linked to, named for the admin lists ("attached item", §15 "Missing"). */
export type LinkedItemLabel = {
  id: string
  kind: 'movie' | 'series' | 'season' | 'episode'
  /** Absent: a season or an episode without a name of its own (§6.3). */
  title?: string
  /** Episodes: their series. */
  seriesTitle?: string
  seasonNumber?: number
  episodeNumber?: number
}

export type SourceListItem = Source & {
  rootPath: string
  itemIds: string[]
  items: LinkedItemLabel[]
}

/** Persistence of `sources` and `source_subtitles`. Synchronous (bun:sqlite). */
export type SourceRepository = {
  listSnapshots: (libraryId: string) => SourceSnapshot[]
  findById: (id: string) => Source | undefined
  /** Absolute path of the source's file (root path + relative path). */
  absolutePathOf: (id: string) => string | undefined
  /** One transaction: inserts then patches. */
  applyChanges: (input: {
    inserts: NewSource[]
    patches: { id: string; patch: SourcePatch }[]
  }) => void
  patch: (id: string, patch: SourcePatch) => void
  listPending: () => PendingSourceView[]
  countPending: () => number
  countsByLibrary: (libraryId: string) => SourceCounts
  pendingBreakdownByLibrary: (libraryId: string) => PendingBreakdown
  page: (query: {
    libraryId?: string
    state?: SourceState
    matchState?: MatchState
    cursor?: string
    limit: number
  }) => {
    /** Every source matching the filters (all pages): the "To review" count (§15). */
    total: number
    items: SourceListItem[]
    nextCursor?: string
  }
  /** Current external subtitles, by source id, for one library. */
  externalSubtitlesByLibrary: (libraryId: string) => Map<string, ExternalSubtitleRow[]>
  replaceExternalSubtitles: (sourceId: string, rows: ExternalSubtitleRow[]) => void
  replaceEmbeddedSubtitles: (sourceId: string, rows: EmbeddedSubtitle[]) => void
}

/**
 * "Manquants" (§7.5, §15): purge of `missing` sources, by the admin or the daily `purge_missing`.
 * Synchronous (bun:sqlite).
 */
export type MissingSourceRepository = {
  stateOf: (id: string) => SourceState | undefined
  /** `missing` sources, of one library or of all; `missingBefore`: missing since before it. */
  listMissingIds: (input: { libraryId?: string; missingBefore?: Date }) => string[]
  /**
   * One transaction: deletes the sources (links, subtitle rows and playback rows go with them,
   * `manual_matches` keeps the correction without its `source_id`), then the items left without
   * source and without child, except those carrying a manual correction (a metadata override,
   * or the identification of one of these files), then their emptied ancestors (§7.5).
   */
  purge: (sourceIds: readonly string[]) => { purged: number; deletedItems: number }
}
