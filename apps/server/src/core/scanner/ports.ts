import type { ScanPhase } from '@projo/shared/api/events'
import type { ScanKind, ScanStats } from '@projo/shared/api/libraries'

import type { NotificationKind } from '../notifications/notification.ts'

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

/**
 * Re-read everything (no directory cache, every ready source relinked): a manual full scan, and
 * the first scan of a library, which has nothing to compare with.
 */
export const isFullScan = (kind: ScanKind): boolean =>
  kind === 'manual_full' || kind === 'initial' || kind === 'rules_update'

/** The name analysis rules version the names were last read with (§7.4 "Startup"). */
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
  /** Error code of the run, e.g. `library/root_unreachable`. */
  error?: string
}

/** Persistence of `scan_runs`. Synchronous (bun:sqlite). */
export type ScanRunRepository = {
  start: (run: { id: string; libraryId: string; kind: ScanKind; startedAt: Date }) => ScanRun
  finish: (input: { id: string; finishedAt: Date; stats: ScanStats; error?: string }) => ScanRun
  latest: (libraryId: string) => ScanRun | undefined
  /** Startup: runs a previous process left open (crash) get `finished_at` and this error. Count. */
  closeUnfinished: (input: { finishedAt: Date; error: string }) => number
  /** Newest first. `cursor` is the id of the last run of the previous page (UUID v7: time-ordered). */
  page: (input: { libraryId: string; cursor?: string; limit: number }) => {
    items: ScanRun[]
    nextCursor?: string
  }
  /** Deletes the runs finished before `before`, except each library's latest; returns how many. */
  purgeFinishedBefore: (before: Date) => number
}

/** Every kind of §15, listed in `@projo/shared/api/notifications`. */
export type { NotificationKind }

/**
 * Admin notifications (§15) raised by the scanner (§7.3, §7.5, §8.1), the job runner on a job's
 * final failure (§18), metadata, updates (§16.4) and the disk watch. `key` identifies the subject
 * (root id, source id, folder, version): one open notification per (kind, key).
 */
export type AdminNotifier = {
  notify: (input: {
    kind: NotificationKind
    severity: 'info' | 'warning' | 'error'
    key: string
    context: Record<string, unknown>
  }) => void
  /** Marks the open notification of (kind, key) resolved (root reachable again, source ready). */
  resolve: (input: { kind: NotificationKind; key: string }) => void
}

/** Directory listing kept between incremental scans (§7.4 "only goes down into those whose mtime changed"). */
export type CachedDirectory = {
  mtimeMs: number
  cachedAt: number
  /** Names of the sub-directories to walk (already filtered). */
  directories: string[]
  /** Names of the candidate files (video and subtitle extensions). */
  files: string[]
  /** Number of entries of the directory (all kinds), for the empty-root guard. */
  entryCount: number
}

export type DirectoryCache = {
  get: (rootId: string, relativePath: string) => CachedDirectory | undefined
  set: (rootId: string, relativePath: string, entry: CachedDirectory) => void
  /** Drops directories of a root that the last walk did not visit. */
  retain: (rootId: string, visited: ReadonlySet<string>) => void
  /** Relative paths of the directories known for a root (watcher fallback). */
  directoriesOf: (rootId: string) => string[]
  forget: (rootId: string) => void
}

/** Enqueues `scan_library` with the §7.4 coalescing rules. */
export type ScanRequester = (input: {
  libraryId: string
  kind: ScanKind
  /** Debounce (watcher: 5 s). */
  delayMs?: number
}) => { jobId: string; deduplicated: boolean }
