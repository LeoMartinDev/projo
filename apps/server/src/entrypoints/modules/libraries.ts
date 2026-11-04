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

export const buildLibrariesModule = (
  { db, ids, clock, logger, jobQueue, jobRepository, eventBus }: Platform,
  {
    playbackSessions,
    metadataContext,
    jobControl,
  }: {
    playbackSessions: PlaybackSessionTerminator
    metadataContext: LibraryMetadataContextObserver
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
