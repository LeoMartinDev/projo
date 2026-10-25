import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { FileSystem } from '../../core/fs/file-system.ts'
import type { LibraryRoot } from '../../core/library/library.ts'
import { normalizeAbsolutePath, pathsOverlap } from '../../core/library/roots.ts'

export type RootValidationError = AppError<
  | 'library/invalid_settings'
  | 'library/root_not_found'
  | 'library/root_not_directory'
  | 'library/root_unreadable'
  | 'library/root_duplicate'
  | 'library/root_overlaps'
>

type Input = {
  paths: readonly string[]
  /** Roots the new paths must not overlap (every library's, minus the ones being replaced). */
  otherRoots: readonly Pick<LibraryRoot, 'id' | 'libraryId' | 'path'>[]
  /** Paths already validated earlier (kept roots of the edited library): not checked on disk again. */
  alreadyValid?: ReadonlySet<string>
}

/**
 * §7.1: absolute, existing, readable directories; two roots never overlap, in the same library
 * or across libraries, compared on the typed path and on the resolved one (symbolic links).
 */
export const validateRootsFactory =
  ({ fileSystem }: { fileSystem: FileSystem }) =>
  async ({
    paths,
    otherRoots,
    alreadyValid = new Set(),
  }: Input): Promise<Result<string[], RootValidationError>> => {
    const normalized: string[] = []
    for (const raw of paths) {
      const path = normalizeAbsolutePath(raw)
      if (!path.ok) {
        return err(
          appError('library/invalid_settings', 'root path must be absolute, without ..', {
            context: { path: raw },
          }),
        )
      }
      if (normalized.includes(path.value)) {
        return err(
          appError('library/root_duplicate', 'root listed twice', {
            context: { path: path.value },
          }),
        )
      }
      normalized.push(path.value)
    }

    const resolved = new Map<string, string>()
    for (const path of normalized) {
      if (alreadyValid.has(path)) {
        resolved.set(path, path)
        continue
      }
      const stat = await fileSystem.stat(path)
      if (!stat.ok) {
        return err(
          stat.error.code === 'fs/path_not_found' || stat.error.code === 'fs/not_a_directory'
            ? appError('library/root_not_found', 'root directory does not exist', {
                context: { path },
              })
            : appError('library/root_unreadable', 'root directory cannot be read', {
                context: { path },
              }),
        )
      }
      if (stat.value.kind !== 'directory') {
        return err(
          appError('library/root_not_directory', 'root path is not a directory', {
            context: { path },
          }),
        )
      }
      const listing = await fileSystem.readDirectory(path)
      if (!listing.ok) {
        return err(
          appError('library/root_unreadable', 'root directory cannot be read', {
            context: { path },
          }),
        )
      }
      const real = await fileSystem.realPath(path)
      resolved.set(path, real.ok ? real.value : path)
    }

    for (const [index, path] of normalized.entries()) {
      for (const other of normalized.slice(index + 1)) {
        if (
          pathsOverlap(path, other) ||
          pathsOverlap(resolved.get(path) ?? path, resolved.get(other) ?? other)
        ) {
          return err(
            appError('library/root_overlaps', 'roots overlap', { context: { path, other } }),
          )
        }
      }
      for (const other of otherRoots) {
        const realOther = await fileSystem.realPath(other.path)
        const otherResolved = realOther.ok ? realOther.value : other.path
        if (path === other.path || (resolved.get(path) ?? path) === otherResolved) {
          return err(
            appError('library/root_duplicate', 'root already used by a library', {
              context: { path, libraryId: other.libraryId },
            }),
          )
        }
        if (
          pathsOverlap(path, other.path) ||
          pathsOverlap(resolved.get(path) ?? path, otherResolved)
        ) {
          return err(
            appError('library/root_overlaps', 'root overlaps a root of a library', {
              context: { path, other: other.path, libraryId: other.libraryId },
            }),
          )
        }
      }
    }
    return ok(normalized)
  }

export type ValidateRoots = ReturnType<typeof validateRootsFactory>
