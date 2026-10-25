import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { IdGenerator } from '../../core/ids.ts'
import type { JobControl } from '../../core/jobs/ports.ts'
import type {
  Library,
  LibraryChanges,
  LibraryLeftovers,
  LibraryMetadataContextObserver,
  LibraryRepository,
  RootChanges,
} from '../../core/library/library.ts'
import { normalizeAbsolutePath } from '../../core/library/roots.ts'
import type { Logger } from '../../core/logger.ts'
import type { PlaybackSessionTerminator } from '../../core/playback/session.ts'
import type { LocalItemRepository } from '../../core/scanner/item-linking.ts'
import type { ScanRequester } from '../../core/scanner/ports.ts'
import type { RootValidationError, ValidateRoots } from './validate-roots.ts'

type Deps = {
  libraryRepository: LibraryRepository
  localItems: Pick<LocalItemRepository, 'itemIdsOfLibrary' | 'pruneOrphans'>
  playbackSessions: PlaybackSessionTerminator
  validateRoots: ValidateRoots
  requestScan: ScanRequester
  /**
   * §9.4: a new language or rating country refreshes the metadata written with the old one, and
   * so does a removed root changing the library deciding a movie or series (§9.1).
   */
  metadataContext: LibraryMetadataContextObserver
  leftovers: LibraryLeftovers
  /** Aborts the running jobs on the removed roots' files (a probe, a subtitle extraction). */
  jobControl: Pick<JobControl, 'cancel'>
  ids: IdGenerator
  logger: Logger
}

export type UpdateLibraryInput = {
  id: string
  changes: LibraryChanges
  /** Replaces the whole set of roots. */
  roots?: string[]
}

export type UpdateLibraryError =
  AppError<'library/not_found' | 'library/name_taken'> | RootValidationError

/**
 * Edits settings and roots. A kept path keeps its root (and sources); a removed root takes its
 * sources with it, and local items left without source are pruned (§7.5 purge rule). Playback
 * sessions on what goes are ended first (§10.6), the queued jobs on its files dropped, the running
 * ones cancelled, its notifications resolved. A new metadata language or rating country queues
 * the refresh of the metadata written with the old one (§9.4).
 */
export const updateLibraryFactory =
  ({
    libraryRepository,
    localItems,
    playbackSessions,
    validateRoots,
    requestScan,
    metadataContext,
    leftovers,
    jobControl,
    ids,
    logger,
  }: Deps) =>
  async ({
    id,
    changes,
    roots,
  }: UpdateLibraryInput): Promise<Result<Library, UpdateLibraryError>> => {
    const library = libraryRepository.findById(id)
    if (library === undefined) {
      return err(appError('library/not_found', 'library not found', { context: { id } }))
    }
    const name = changes.name?.trim()
    if (name !== undefined) {
      const sameName = libraryRepository.findByName(name)
      if (sameName !== undefined && sameName.id !== id) {
        return err(
          appError('library/name_taken', 'library name already used', { context: { name } }),
        )
      }
    }

    let rootChanges: RootChanges | undefined
    if (roots !== undefined) {
      const current = new Map(library.roots.map((root) => [root.path, root]))
      const kept = new Set(
        roots.flatMap((raw) => {
          const path = normalizeAbsolutePath(raw)
          return path.ok && current.has(path.value) ? [path.value] : []
        }),
      )
      const validated = await validateRoots({
        paths: roots,
        otherRoots: libraryRepository.listRoots().filter((root) => root.libraryId !== id),
        alreadyValid: kept,
      })
      if (!validated.ok) return validated
      const wanted = new Set(validated.value)
      rootChanges = {
        add: validated.value
          .filter((path) => !current.has(path))
          .map((path) => ({ id: ids.next(), path })),
        remove: library.roots.filter((root) => !wanted.has(root.path)).map((root) => root.id),
      }
    }

    const removing = rootChanges !== undefined && rootChanges.remove.length > 0
    const linkedBefore = removing ? localItems.itemIdsOfLibrary(id) : []
    const settle =
      rootChanges !== undefined && removing
        ? metadataContext.filesLeaving({ rootIds: rootChanges.remove })
        : undefined
    if (rootChanges !== undefined && removing) {
      // Before the cascade: the jobs on their sources are found through the `sources` rows.
      const { runningJobIds } = leftovers.clear({ rootIds: rootChanges.remove })
      for (const jobId of runningJobIds) jobControl.cancel(jobId)
      playbackSessions.endWithin({ rootIds: rootChanges.remove })
    }
    const updated = libraryRepository.update({
      id,
      changes: { ...changes, ...(name === undefined ? {} : { name }) },
      ...(rootChanges === undefined ? {} : { roots: rootChanges }),
    })
    if (rootChanges !== undefined) {
      if (linkedBefore.length > 0) {
        localItems.pruneOrphans(linkedBefore, (pruned) =>
          playbackSessions.endWithin({ itemIds: pruned }),
        )
      }
      if (rootChanges.add.length > 0) requestScan({ libraryId: id, kind: 'manual_quick' })
    }
    settle?.()
    // The hint drives classification (§7.1): every name is read again.
    if (changes.hint !== undefined && changes.hint !== library.hint) {
      requestScan({ libraryId: id, kind: 'manual_full' })
    }
    const language = updated.metadataLanguage !== library.metadataLanguage
    const ratingCountry = updated.ratingCountry !== library.ratingCountry
    if (language || ratingCountry)
      metadataContext.changed({ libraryId: id, language, ratingCountry })
    logger.info('library updated', { libraryId: id })
    return ok(updated)
  }
