import type { ReviewReason } from '@projo/shared/api/metadata'

import type { MediaProbe, EmbeddedSubtitle } from '../media/probe.ts'
import type { Classification, ParsedName } from '../naming/index.ts'

export type SourceState = 'pending' | 'ready' | 'missing' | 'rejected'
export type PendingReason = 'growing' | 'probe_failed' | 'decode_failed' | 'too_small'
export type MatchState = 'unmatched' | 'matched' | 'manual' | 'needs_review'

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
  pendingSince?: Date
  unchangedSince?: Date
  stableSince?: Date
  missingSince?: Date
  probe?: MediaProbe
  reviewReason?: ReviewReason
}

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
  path: string
  language?: string
  forced: boolean
  sdh: boolean
  isDefault: boolean
  format: string
  title?: string
}

export type SourceCounts = Record<SourceState, number>

export type PendingBreakdown = {
  waiting: number
  verifying: number
  failed: number
  earliestUnchangedSince?: Date
}

export type LinkedItemLabel = {
  id: string
  kind: 'movie' | 'series' | 'season' | 'episode'
  title?: string
  seriesTitle?: string
  seasonNumber?: number
  episodeNumber?: number
}

export type SourceListItem = Source & {
  rootPath: string
  itemIds: string[]
  items: LinkedItemLabel[]
}

export type SourceRepository = {
  listSnapshots: (libraryId: string) => SourceSnapshot[]
  findById: (id: string) => Source | undefined
  absolutePathOf: (id: string) => string | undefined
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
    reviewReason?: ReviewReason
    cursor?: string
    limit: number
  }) => {
    total: number
    items: SourceListItem[]
    nextCursor?: string
  }
  reviewSummary: () => {
    toReview: { libraryId: string; reason?: ReviewReason; count: number }[]
    byState: SourceCounts
  }
  externalSubtitlesByLibrary: (libraryId: string) => Map<string, ExternalSubtitleRow[]>
  replaceExternalSubtitles: (sourceId: string, rows: ExternalSubtitleRow[]) => void
  replaceEmbeddedSubtitles: (sourceId: string, rows: EmbeddedSubtitle[]) => void
}

export type MissingSourceRepository = {
  stateOf: (id: string) => SourceState | undefined
  listMissingIds: (input: { libraryId?: string; missingBefore?: Date }) => string[]
  purge: (sourceIds: readonly string[]) => { purged: number; deletedItems: number }
}
