import type { ScanPhase } from '@projo/shared/api/events'
import type { ScanKind, ScanStats } from '@projo/shared/api/libraries'

export type { ScanKind, ScanPhase, ScanStats }

export const emptyScanStats = (): ScanStats => ({
  discovered: 0,
  pending: 0,
  ready: 0,
  missing: 0,
  errors: 0,
  seen: 0,
  moved: 0,
})

export const isFullScan = (kind: ScanKind): boolean =>
  kind === 'manual_full' || kind === 'initial' || kind === 'rules_update'

export type NamingRulesVersionStore = {
  read: () => number | undefined
  write: (input: { version: number; at: Date }) => void
}

export type ScanRun = {
  id: string
  libraryId: string
  kind: ScanKind
  startedAt: Date
  finishedAt?: Date
  stats: ScanStats
  error?: string
}

export type ScanRunRepository = {
  start: (run: { id: string; libraryId: string; kind: ScanKind; startedAt: Date }) => ScanRun
  finish: (input: { id: string; finishedAt: Date; stats: ScanStats; error?: string }) => ScanRun
  latest: (libraryId: string) => ScanRun | undefined
  closeUnfinished: (input: { finishedAt: Date; error: string }) => number
  page: (input: { libraryId: string; cursor?: string; limit: number }) => {
    items: ScanRun[]
    nextCursor?: string
  }
  purgeFinishedBefore: (before: Date) => number
}

export type CachedDirectory = {
  mtimeMs: number
  cachedAt: number
  /** The mtime was already older than the file clock's granularity when the listing was read. */
  settled: boolean
  directories: string[]
  files: string[]
  entryCount: number
}

export type DirectoryCache = {
  get: (rootId: string, relativePath: string) => CachedDirectory | undefined
  set: (rootId: string, relativePath: string, entry: CachedDirectory) => void
  retain: (rootId: string, visited: ReadonlySet<string>) => void
  directoriesOf: (rootId: string) => string[]
  forget: (rootId: string) => void
}

export type ScanRequester = (input: { libraryId: string; kind: ScanKind; delayMs?: number }) => {
  jobId: string
  deduplicated: boolean
}
