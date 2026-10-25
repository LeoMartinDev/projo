import { lstat, readdir, statfs } from 'node:fs/promises'

import type { DiskUsage } from '../../core/stats/stats.ts'

const sizeOf = async (path: string): Promise<number> => {
  let info
  try {
    info = await lstat(path)
  } catch {
    // Absent (no WAL yet, an empty cache) or gone while walking.
    return 0
  }
  if (info.isSymbolicLink()) return 0
  if (!info.isDirectory()) return info.size
  let entries: string[]
  try {
    entries = await readdir(path)
  } catch {
    return 0
  }
  let total = 0
  // Sequential: a cache of thousands of files must not open thousands of handles at once.
  for (const entry of entries) total += await sizeOf(`${path}/${entry}`)
  return total
}

/**
 * Disk usage under `/data` (§15 "Server", `cache/disk_low`): sizes by walking (symlinks such as
 * `app/current` not followed), the file system by `statfs`.
 */
export const createNodeDiskUsage = (): DiskUsage => ({
  directorySize: sizeOf,
  fileSystem: async (path) => {
    try {
      const info = await statfs(path)
      return {
        totalBytes: Number(info.blocks) * Number(info.bsize),
        freeBytes: Number(info.bavail) * Number(info.bsize),
      }
    } catch {
      return undefined
    }
  },
})
