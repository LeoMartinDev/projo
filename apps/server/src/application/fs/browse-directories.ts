import { appError, err, ok, type Result } from '@projo/shared'

import type { FileSystem, FsError } from '../../core/fs/file-system.ts'
import {
  joinAbsolute,
  normalizeAbsolutePath,
  parentOf,
  relativeTo,
} from '../../core/library/roots.ts'

export const BROWSE_MAX_ENTRIES = 2_000

export type BrowseEntry = { name: string; path: string; hidden: boolean; symlink: boolean }
export type BrowseResult = {
  path: string
  parent?: string
  entries: BrowseEntry[]
  truncated: boolean
}
export type BrowseError = FsError | ReturnType<typeof invalidPath>

const invalidPath = (path: string, reason: string) =>
  appError('fs/invalid_path', `invalid path: ${reason}`, { context: { path, reason } })

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })

/**
 * §20 directory picker: read only, directories only, absolute paths without `..`. Symbolic links
 * are listed only when they resolve inside the browsed directory, and a path that goes through a
 * link escaping its own parent is refused.
 */
export const browseDirectoriesFactory =
  ({ fileSystem }: { fileSystem: FileSystem }) =>
  async ({ path: raw }: { path: string }): Promise<Result<BrowseResult, BrowseError>> => {
    const normalized = normalizeAbsolutePath(raw)
    if (!normalized.ok) return normalized
    const path = normalized.value

    // Every step of the path must stay inside the real directory of its parent.
    let realParent = '/'
    let walked = '/'
    for (const segment of path.split('/').filter((s) => s !== '')) {
      walked = joinAbsolute(walked, segment)
      const real = await fileSystem.realPath(walked)
      if (!real.ok) return real
      if (relativeTo(realParent, real.value) === undefined) {
        return err(invalidPath(path, 'symbolic link outside its directory'))
      }
      realParent = real.value
    }

    const stat = await fileSystem.stat(realParent)
    if (!stat.ok) return stat
    if (stat.value.kind !== 'directory') {
      return err(appError('fs/not_a_directory', 'path is not a directory', { context: { path } }))
    }
    const listing = await fileSystem.readDirectory(realParent)
    if (!listing.ok) return listing

    const entries: BrowseEntry[] = []
    for (const entry of listing.value) {
      const hidden = entry.name.startsWith('.')
      if (entry.kind === 'directory') {
        entries.push({
          name: entry.name,
          path: joinAbsolute(path, entry.name),
          hidden,
          symlink: false,
        })
        continue
      }
      if (entry.kind !== 'symlink') continue
      const target = await fileSystem.realPath(joinAbsolute(realParent, entry.name))
      if (!target.ok) continue
      const inside = relativeTo(realParent, target.value)
      if (inside === undefined || inside === '') continue
      const targetStat = await fileSystem.stat(target.value)
      if (!targetStat.ok || targetStat.value.kind !== 'directory') continue
      entries.push({
        name: entry.name,
        path: joinAbsolute(path, entry.name),
        hidden,
        symlink: true,
      })
    }
    entries.sort((a, b) => collator.compare(a.name, b.name))
    const parent = parentOf(path)
    return ok({
      path,
      ...(parent === undefined ? {} : { parent }),
      entries: entries.slice(0, BROWSE_MAX_ENTRIES),
      truncated: entries.length > BROWSE_MAX_ENTRIES,
    })
  }

export type BrowseDirectories = ReturnType<typeof browseDirectoriesFactory>
