import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { IdGenerator } from '../../core/ids.ts'
import type { Library, LibraryRepository, LibrarySettings } from '../../core/library/library.ts'
import type { Logger } from '../../core/logger.ts'
import type { ScanRequester } from '../../core/scanner/ports.ts'
import type { RootValidationError, ValidateRoots } from './validate-roots.ts'

type Deps = {
  libraryRepository: LibraryRepository
  validateRoots: ValidateRoots
  requestScan: ScanRequester
  clock: Clock
  ids: IdGenerator
  logger: Logger
}

export type CreateLibraryInput = LibrarySettings & { name: string; roots: string[] }
export type CreateLibraryError = AppError<'library/name_taken'> | RootValidationError

/** §7.1 "Add a library": validates name and roots, saves, then starts the first scan. */
export const createLibraryFactory =
  ({ libraryRepository, validateRoots, requestScan, clock, ids, logger }: Deps) =>
  async (input: CreateLibraryInput): Promise<Result<Library, CreateLibraryError>> => {
    const name = input.name.trim()
    if (libraryRepository.findByName(name) !== undefined) {
      return err(appError('library/name_taken', 'library name already used', { context: { name } }))
    }
    const roots = await validateRoots({
      paths: input.roots,
      otherRoots: libraryRepository.listRoots(),
    })
    if (!roots.ok) return roots
    const { roots: _paths, name: _name, ...settings } = input
    const library = libraryRepository.create({
      ...settings,
      id: ids.next(),
      name,
      createdAt: clock.now(),
      roots: roots.value.map((path) => ({ id: ids.next(), path })),
    })
    requestScan({ libraryId: library.id, kind: 'initial' })
    logger.info('library created', { libraryId: library.id, roots: roots.value.length })
    return ok(library)
  }
