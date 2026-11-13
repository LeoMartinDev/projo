import type { Clock } from '../../core/clock.ts'
import type { DirectoryEntry, FileSystem } from '../../core/fs/file-system.ts'
import { joinAbsolute, relativeTo } from '../../core/library/roots.ts'
import {
  directoryOf,
  extensionOf,
  filterDirectory,
  filterFile,
  MIN_VIDEO_SIZE_BYTES,
  SUBTITLE_EXTENSIONS,
  VIDEO_EXTENSIONS,
} from '../../core/naming/index.ts'
import type { FoundFile } from '../../core/scanner/scan-plan.ts'
import type { CachedDirectory, DirectoryCache } from '../../core/scanner/ports.ts'

export const DIRECTORY_CACHE_MAX_AGE_MS = 60 * 60 * 1000
/**
 * Filesystems stamp mtimes from a coarse clock (a kernel tick of a few ms, 1 to 2 s on FAT, exFAT
 * and some network shares): a directory changed in the same tick as its listing was read keeps the
 * same mtime. A listing is reused only when its mtime was older than this when it was read (git's
 * "racily clean" entries); a recent one is read again on the next walk.
 */
export const MTIME_GRANULARITY_MS = 2_000

const CANDIDATE_EXTENSIONS: ReadonlySet<string> = new Set([
  ...VIDEO_EXTENSIONS,
  ...SUBTITLE_EXTENSIONS,
  'iso',
  'disc',
])

const join = (directory: string, name: string): string =>
  directory === '' ? name : `${directory}/${name}`

export type WalkResult = {
  videos: FoundFile[]
  subtitles: string[]
  directories: Set<string>
  failedDirectories: string[]
  failedFiles: string[]
  unsupportedLayouts: string[]
  rootEntryCount: number
  errors: number
  aborted: boolean
}

type Deps = {
  fileSystem: FileSystem
  directoryCache: DirectoryCache
  clock: Clock
  /** The clock mtimes are stamped with (the host's), compared to them to settle a listing. */
  fileClock: Clock
}

type WalkInput = {
  rootId: string
  rootPath: string
  incremental: boolean
  signal?: AbortSignal
  onProgress?: (seen: number) => void
}

export const walkRootFactory =
  ({ fileSystem, directoryCache, clock, fileClock }: Deps) =>
  async ({ rootId, rootPath, incremental, signal, onProgress }: WalkInput): Promise<WalkResult> => {
    const result: WalkResult = {
      videos: [],
      subtitles: [],
      directories: new Set(),
      failedDirectories: [],
      failedFiles: [],
      unsupportedLayouts: [],
      rootEntryCount: 0,
      errors: 0,
      aborted: false,
    }
    const realRoot = await fileSystem.realPath(rootPath)
    const followedTargets = new Set<string>()
    const stack: string[] = ['']
    const now = clock.now().getTime()
    const settledBefore = fileClock.now().getTime() - MTIME_GRANULARITY_MS

    const listing = async (relative: string): Promise<CachedDirectory | undefined> => {
      const absolute = joinAbsolute(rootPath, relative)
      const stat = await fileSystem.stat(absolute)
      if (!stat.ok) return undefined
      const cached = incremental ? directoryCache.get(rootId, relative) : undefined
      if (
        cached !== undefined &&
        cached.settled &&
        cached.mtimeMs === stat.value.mtimeMs &&
        now - cached.cachedAt < DIRECTORY_CACHE_MAX_AGE_MS
      ) {
        return cached
      }
      const entries = await fileSystem.readDirectory(absolute)
      if (!entries.ok) return undefined
      const decision = filterDirectory({
        relativePath: relative,
        entryNames: entries.value.map((entry) => entry.name),
      })
      const settled = stat.value.mtimeMs < settledBefore
      if (decision.kind === 'skip') {
        return {
          mtimeMs: stat.value.mtimeMs,
          cachedAt: now,
          settled,
          directories: [],
          files: [],
          entryCount: 0,
        }
      }
      const directories: string[] = []
      const files: string[] = []
      let hasSymlink = false
      for (const entry of entries.value) {
        const kind = await resolveKind(absolute, entry)
        if (entry.kind === 'symlink') hasSymlink = true
        if (kind === 'directory') directories.push(entry.name)
        else if (kind === 'file' && CANDIDATE_EXTENSIONS.has(extensionOf(entry.name)))
          files.push(entry.name)
        else if (kind === 'unreachable') {
          result.failedDirectories.push(join(relative, entry.name))
          result.errors += 1
        }
      }
      const fresh: CachedDirectory = {
        mtimeMs: stat.value.mtimeMs,
        cachedAt: now,
        settled,
        directories,
        files,
        entryCount: entries.value.length,
      }
      if (!hasSymlink) directoryCache.set(rootId, relative, fresh)
      return fresh
    }

    const resolveKind = async (
      parent: string,
      entry: DirectoryEntry,
    ): Promise<'file' | 'directory' | 'other' | 'unreachable'> => {
      if (entry.kind !== 'symlink') return entry.kind
      const target = joinAbsolute(parent, entry.name)
      const stat = await fileSystem.stat(target)
      if (!stat.ok) return 'unreachable'
      if (stat.value.kind !== 'directory') return stat.value.kind
      const real = await fileSystem.realPath(target)
      if (!real.ok) return 'unreachable'
      if (realRoot.ok && relativeTo(realRoot.value, real.value) !== undefined) return 'other'
      if (followedTargets.has(real.value)) return 'other'
      followedTargets.add(real.value)
      return 'directory'
    }

    while (stack.length > 0) {
      if (signal?.aborted === true) {
        result.aborted = true
        return result
      }
      const relative = stack.pop() ?? ''
      const entry = await listing(relative)
      if (entry === undefined) {
        result.failedDirectories.push(relative)
        result.errors += 1
        continue
      }
      result.directories.add(relative)
      if (relative === '') result.rootEntryCount = entry.entryCount
      for (const name of entry.directories) {
        const child = join(relative, name)
        const byName = filterDirectory({ relativePath: child, entryNames: [] })
        if (byName.kind === 'descend') stack.push(child)
        else if (byName.reason === 'unsupported_layout') result.unsupportedLayouts.push(child)
      }

      const videos: string[] = []
      for (const name of entry.files) {
        const relativePath = join(relative, name)
        const filtered = filterFile({ relativePath, sizeBytes: MIN_VIDEO_SIZE_BYTES })
        if (filtered.kind === 'subtitle') result.subtitles.push(relativePath)
        else if (filtered.kind === 'video') videos.push(relativePath)
        else if (filtered.reason === 'unsupported_layout')
          result.unsupportedLayouts.push(directoryOf(relativePath))
      }
      const stats = await Promise.all(
        videos.map((relativePath) => fileSystem.stat(joinAbsolute(rootPath, relativePath))),
      )
      stats.forEach((stat, index) => {
        const relativePath = videos[index] ?? ''
        if (stat.ok) {
          if (stat.value.kind !== 'file') return
          result.videos.push({
            rootId,
            relativePath,
            sizeBytes: stat.value.sizeBytes,
            mtimeMs: stat.value.mtimeMs,
            inode: stat.value.inode,
          })
        } else if (stat.error.code !== 'fs/path_not_found') {
          result.failedFiles.push(relativePath)
          result.errors += 1
        }
      })
      if (videos.length > 0) onProgress?.(result.videos.length)
    }
    directoryCache.retain(rootId, result.directories)
    result.unsupportedLayouts = [...new Set(result.unsupportedLayouts)]
    return result
  }

export type WalkRoot = ReturnType<typeof walkRootFactory>
