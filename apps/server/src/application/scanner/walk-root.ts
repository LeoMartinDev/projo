import type { Clock } from '../../core/clock.ts'
import type { DirectoryEntry, FileSystem } from '../../core/fs/file-system.ts'
import { joinAbsolute, relativeTo } from '../../core/library/roots.ts'
import {
  filterDirectory,
  filterFile,
  MIN_VIDEO_SIZE_BYTES,
  SUBTITLE_EXTENSIONS,
  VIDEO_EXTENSIONS,
} from '../../core/naming/index.ts'
import type { FoundFile } from '../../core/scanner/scan-plan.ts'
import type { CachedDirectory, DirectoryCache } from '../../core/scanner/ports.ts'

/** A cached listing older than this is read again even if the directory mtime did not move (network shares). */
export const DIRECTORY_CACHE_MAX_AGE_MS = 60 * 60 * 1000

/** Extensions worth a look: videos, subtitles, and the disc images reported as unsupported (§8.1). */
const CANDIDATE_EXTENSIONS: ReadonlySet<string> = new Set([
  ...VIDEO_EXTENSIONS,
  ...SUBTITLE_EXTENSIONS,
  'iso',
  'disc',
])

const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

const join = (directory: string, name: string): string =>
  directory === '' ? name : `${directory}/${name}`

const directoryOf = (relativePath: string): string => {
  const index = relativePath.lastIndexOf('/')
  return index < 0 ? '' : relativePath.slice(0, index)
}

export type WalkResult = {
  videos: FoundFile[]
  /** Subtitle files, relative to the root. */
  subtitles: string[]
  /** Directories walked, relative (`''` = root). */
  directories: Set<string>
  /** Directories that could not be read: what they hold must not be marked missing. */
  failedDirectories: string[]
  /** Files that could not be stat'ed for another reason than "gone". */
  failedFiles: string[]
  /** Folders holding an unsupported layout (§8.1: VIDEO_TS, BDMV, .iso, 3D). */
  unsupportedLayouts: string[]
  /** Entries directly under the root (§7.5 empty-root guard). */
  rootEntryCount: number
  errors: number
  aborted: boolean
}

type Deps = { fileSystem: FileSystem; directoryCache: DirectoryCache; clock: Clock }

type WalkInput = {
  rootId: string
  rootPath: string
  /** Reuse listings of directories whose mtime did not change (§7.4 incremental scan). */
  incremental: boolean
  signal?: AbortSignal
  onProgress?: (seen: number) => void
}

/**
 * Recursive walk of one root (§7.2 "Discovery" + "Filter"). Applies `filterDirectory` to every
 * folder (`.ignore`, `.nomedia`, bonus and excluded folders) and `filterFile` to every file; stats
 * video files only. Symbolic links are followed once, never back into the root (loops).
 */
export const walkRootFactory =
  ({ fileSystem, directoryCache, clock }: Deps) =>
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

    const listing = async (relative: string): Promise<CachedDirectory | undefined> => {
      const absolute = joinAbsolute(rootPath, relative)
      const stat = await fileSystem.stat(absolute)
      if (!stat.ok) return undefined
      const cached = incremental ? directoryCache.get(rootId, relative) : undefined
      if (
        cached !== undefined &&
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
      if (decision.kind === 'skip') {
        return {
          mtimeMs: stat.value.mtimeMs,
          cachedAt: now,
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
      }
      const fresh: CachedDirectory = {
        mtimeMs: stat.value.mtimeMs,
        cachedAt: now,
        directories,
        files,
        entryCount: entries.value.length,
      }
      // A listing with links depends on their targets: never reused.
      if (!hasSymlink) directoryCache.set(rootId, relative, fresh)
      return fresh
    }

    const resolveKind = async (
      parent: string,
      entry: DirectoryEntry,
    ): Promise<'file' | 'directory' | 'other'> => {
      if (entry.kind !== 'symlink') return entry.kind
      const target = joinAbsolute(parent, entry.name)
      const stat = await fileSystem.stat(target)
      if (!stat.ok) return 'other'
      if (stat.value.kind !== 'directory') return stat.value.kind
      const real = await fileSystem.realPath(target)
      if (!real.ok) return 'other'
      // Back into the root (or a loop): the content is already walked through its real path.
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
        // Name-only rules first (`@eaDir`, `.trickplay`, `Extras`…): such folders are never stat'ed nor read.
        const byName = filterDirectory({ relativePath: child, entryNames: [] })
        if (byName.kind === 'descend') stack.push(child)
        else if (byName.reason === 'unsupported_layout') result.unsupportedLayouts.push(child)
      }

      const videos: string[] = []
      for (const name of entry.files) {
        const relativePath = join(relative, name)
        // Size is checked by the planner: a known source that shrank must be seen (`too_small`).
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
