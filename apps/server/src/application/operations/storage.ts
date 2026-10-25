import type { Clock } from '../../core/clock.ts'
import type { DataPaths } from '../../core/data-paths.ts'
import type { DiskUsage, StorageCategory, StorageUsage } from '../../core/stats/stats.ts'

/** §15 "Server": walking the caches is not free, a measure is reused this long. */
export const STORAGE_MAX_AGE_MS = 5 * 60_000

/** What each category of `GET /admin/stats` measures, in the §5.4 layout. */
export const storagePaths = (paths: DataPaths): Record<StorageCategory, string[]> => ({
  database: [paths.db.file, `${paths.db.file}-wal`, `${paths.db.file}-shm`],
  backups: [paths.db.backups],
  images: [paths.images.dir],
  transcode: [paths.cache.transcode],
  trickplay: [paths.cache.trickplay],
  subtitles: [paths.cache.subtitles],
  keyframes: [paths.cache.keyframes],
  previews: [paths.cache.previews],
  app: [paths.app.dir],
  logs: [paths.logs],
})

/**
 * Space used under `/data` by category and the file system's room, measured at most every
 * `maxAgeMs` (calls during a measure share it).
 */
export const measureStorageFactory = ({
  diskUsage,
  paths,
  clock,
  maxAgeMs = STORAGE_MAX_AGE_MS,
}: {
  diskUsage: DiskUsage
  paths: DataPaths
  clock: Clock
  maxAgeMs?: number
}): (() => Promise<StorageUsage>) => {
  let last: StorageUsage | undefined
  let running: Promise<StorageUsage> | undefined

  const measure = async (): Promise<StorageUsage> => {
    const categories: StorageUsage['categories'] = []
    for (const [category, targets] of Object.entries(storagePaths(paths)) as [
      StorageCategory,
      string[],
    ][]) {
      let bytes = 0
      for (const target of targets) bytes += await diskUsage.directorySize(target)
      categories.push({ category, bytes })
    }
    const fileSystem = await diskUsage.fileSystem(paths.root)
    return {
      categories,
      ...(fileSystem === undefined
        ? {}
        : { totalBytes: fileSystem.totalBytes, freeBytes: fileSystem.freeBytes }),
      measuredAt: clock.now(),
    }
  }

  return () => {
    if (last !== undefined && clock.now().getTime() - last.measuredAt.getTime() < maxAgeMs)
      return Promise.resolve(last)
    running ??= measure()
      .then((usage) => {
        last = usage
        return usage
      })
      .finally(() => {
        running = undefined
      })
    return running
  }
}
