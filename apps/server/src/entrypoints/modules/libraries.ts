import { createLibraryFactory } from '../../application/library/create-library.ts'
import { deleteLibraryFactory } from '../../application/library/delete-library.ts'
import {
  libraryViewsFactory,
  requestLibraryScanFactory,
} from '../../application/library/library-views.ts'
import { updateLibraryFactory } from '../../application/library/update-library.ts'
import { validateRootsFactory } from '../../application/library/validate-roots.ts'
import { requestScanFactory } from '../../application/scanner/request-scan.ts'
import { createNodeFileSystem } from '../../infrastructure/fs/node-file-system.ts'
import { createSqliteLibraryLeftovers } from '../../infrastructure/sqlite/library-leftovers.ts'
import { createSqliteLibraryRepository } from '../../infrastructure/sqlite/library-repository.ts'
import { createSqliteLocalItemRepository } from '../../infrastructure/sqlite/local-item-repository.ts'
import { createSqliteScanRunRepository } from '../../infrastructure/sqlite/scan-run-repository.ts'
import { createSqliteSourceRepository } from '../../infrastructure/sqlite/source-repository.ts'
import { adminLibrariesRoutes } from '../http/routes/admin-libraries.ts'
import type { JobControl } from '../../core/jobs/ports.ts'
import type { LibraryMetadataContextObserver } from '../../core/library/library.ts'
import type { PlaybackSessionTerminator } from '../../core/playback/session.ts'
import type { Platform } from './platform.ts'

/**
 * Wiring of the libraries domain (§7.1, §17.2 Admin librairies): CRUD with root validation, scan
 * requests (the scans themselves run in the scanner module), scan history.
 */
export const buildLibrariesModule = (
  { db, ids, clock, logger, jobQueue, jobRepository, eventBus }: Platform,
  {
    playbackSessions,
    metadataContext,
    jobControl,
  }: {
    /** From the playback module: sessions on deleted sources are ended first. */
    playbackSessions: PlaybackSessionTerminator
    /**
     * From the metadata module: a new language or rating country, or files leaving that change
     * the deciding library of a movie or series, refresh (§9.1, §9.4).
     */
    metadataContext: LibraryMetadataContextObserver
    /** The runner (bound after the modules): a deletion aborts the running jobs on what goes. */
    jobControl: Pick<JobControl, 'cancel'>
  },
) => {
  const libraryRepository = createSqliteLibraryRepository({ db })
  const sourceRepository = createSqliteSourceRepository({ db, ids })
  const scanRunRepository = createSqliteScanRunRepository({ db })
  const localItems = createSqliteLocalItemRepository({ db })
  const leftovers = createSqliteLibraryLeftovers({ db, clock })
  const validateRoots = validateRootsFactory({ fileSystem: createNodeFileSystem() })
  const requestScan = requestScanFactory({ jobQueue, jobRepository, clock, eventBus })
  const moduleLogger = logger.child({ module: 'libraries' })
  return {
    routes: adminLibrariesRoutes({
      views: libraryViewsFactory({ libraryRepository, sourceRepository, scanRunRepository }),
      createLibrary: createLibraryFactory({
        libraryRepository,
        validateRoots,
        requestScan,
        clock,
        ids,
        logger: moduleLogger,
      }),
      updateLibrary: updateLibraryFactory({
        libraryRepository,
        localItems,
        playbackSessions,
        validateRoots,
        requestScan,
        metadataContext,
        leftovers,
        jobControl,
        ids,
        logger: moduleLogger,
      }),
      deleteLibrary: deleteLibraryFactory({
        libraryRepository,
        localItems,
        playbackSessions,
        metadataContext,
        leftovers,
        jobControl,
        logger: moduleLogger,
      }),
      requestLibraryScan: requestLibraryScanFactory({ libraryRepository, requestScan }),
    }),
  }
}
