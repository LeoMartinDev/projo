import type { AppError, Result } from '@projo/shared'
import type { ScanKind } from '@projo/shared/api/libraries'
import type { StorageCategory } from '@projo/shared/api/system'

/** §15 "Dashboard" and "Server": counters, storage, database export. Types and ports. */

export type { StorageCategory }

/** Visible items (§6.3) and sources by state. */
export type CatalogCounts = {
  movies: number
  series: number
  episodes: number
  pendingSources: number
  /** `match_state = needs_review` ("To review"). */
  needsReview: number
  missingSources: number
}

export type RunningScan = {
  libraryId: string
  libraryName: string
  scanRunId: string
  kind: ScanKind
  startedAt: Date
}

/** Read-only SQL for the dashboard. Synchronous (bun:sqlite). */
export type StatsQueries = {
  counts: () => CatalogCounts
  /** `scan_runs` without `finished_at`. */
  runningScans: () => RunningScan[]
  /** `playback_sessions` without `ended_at` (§15 "sessions actives"). */
  activePlaybackSessions: () => number
}

export type StorageUsage = {
  categories: { category: StorageCategory; bytes: number }[]
  totalBytes?: number
  freeBytes?: number
  measuredAt: Date
}

/** Disk usage under `/data` (§15 "Server", `cache/disk_low`). */
export type DiskUsage = {
  /** Bytes of the files under `path` (recursive, symlinks not followed); 0 when absent. */
  directorySize: (path: string) => Promise<number>
  /** The file system holding `path`; `undefined` when the platform does not tell. */
  fileSystem: (path: string) => Promise<{ totalBytes: number; freeBytes: number } | undefined>
}

/** "Exporter la base" (§5.4): `VACUUM INTO` a new file. */
export type DatabaseExporter = {
  exportTo: (file: string) => Result<{ sizeBytes: number }, AppError<'db/export_failed'>>
}

/** `projo-export-<YYYYMMDD-HHmmss>.db` (UTC), in `db/backups/`. */
export const exportFileName = (at: Date): string => {
  const iso = at.toISOString()
  const stamp = `${iso.slice(0, 10).replaceAll('-', '')}-${iso.slice(11, 19).replaceAll(':', '')}`
  return `projo-export-${stamp}.db`
}
