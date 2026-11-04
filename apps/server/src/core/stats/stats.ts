import type { AppError, Result } from '@projo/shared'
import type { ScanKind } from '@projo/shared/api/libraries'
import type { StorageCategory } from '@projo/shared/api/system'

export type { StorageCategory }

export type CatalogCounts = {
  movies: number
  series: number
  episodes: number
  pendingSources: number
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

export type StatsQueries = {
  counts: () => CatalogCounts
  runningScans: () => RunningScan[]
  activePlaybackSessions: () => number
}

export type StorageUsage = {
  categories: { category: StorageCategory; bytes: number }[]
  totalBytes?: number
  freeBytes?: number
  measuredAt: Date
}

export type DiskUsage = {
  directorySize: (path: string) => Promise<number>
  fileSystem: (path: string) => Promise<{ totalBytes: number; freeBytes: number } | undefined>
}

export type DatabaseExporter = {
  exportTo: (file: string) => Result<{ sizeBytes: number }, AppError<'db/export_failed'>>
}

export const exportFileName = (at: Date): string => {
  const iso = at.toISOString()
  const stamp = `${iso.slice(0, 10).replaceAll('-', '')}-${iso.slice(11, 19).replaceAll(':', '')}-${iso.slice(20, 23)}`
  return `projo-export-${stamp}.db`
}
