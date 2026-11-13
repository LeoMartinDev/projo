import { createLibraryFactory } from '../../application/library/create-library.ts'
import { deleteLibraryFactory } from '../../application/library/delete-library.ts'
import { getLibraryFactory } from '../../application/library/get-library.ts'
import { listLibrariesFactory } from '../../application/library/list-libraries.ts'
import { listLibraryScansFactory } from '../../application/library/list-library-scans.ts'
import { requestLibraryScanFactory } from '../../application/library/request-library-scan.ts'
import { libraryViewFactory } from '../../application/library/shared/library-view.ts'
import { validateRootsFactory } from '../../application/library/shared/validate-roots.ts'
import { updateLibraryFactory } from '../../application/library/update-library.ts'
import { requestScanFactory } from '../../application/scanner/request-scan.ts'
import { createNodeFileSystem } from '../../infrastructure/fs/node-file-system.ts'
import { createSqliteLibraryLeftovers } from '../../infrastructure/sqlite/library-leftovers.ts'
import { createSqliteLibraryRepository } from '../../infrastructure/sqlite/library-repository.ts'
import { createSqliteLocalItemRepository } from '../../infrastructure/sqlite/local-item-repository.ts'
import { createSqliteScanRunRepository } from '../../infrastructure/sqlite/scan-run-repository.ts'
import { createSqliteSourceRepository } from '../../infrastructure/sqlite/source-repository.ts'
import { adminLibrariesRoutes } from '../http/routes/admin-libraries.ts'
import type { LibraryMetadataContextObserver } from '../../core/library/library.ts'
import type { PlaybackSessionTerminator } from '../../core/playback/session.ts'
import type { Platform } from './platform.ts'
import { defineModule } from './types.ts'

export const buildLibrariesModule = (
  { db, ids, clock, logger, jobQueue, jobRepository, jobControl, eventBus }: Platform,
  {
    playbackSessions,
    metadataContext,
  }: {
    playbackSessions: PlaybackSessionTerminator
    metadataContext: LibraryMetadataContextObserver
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
  return defineModule({
    exposes: {
      routes: adminLibrariesRoutes({
        listLibraries: listLibrariesFactory({
          libraryRepository,
          sourceRepository,
          scanRunRepository,
        }),
        getLibrary: getLibraryFactory({ libraryRepository, sourceRepository, scanRunRepository }),
        libraryView: libraryViewFactory({ sourceRepository, scanRunRepository }),
        listLibraryScans: listLibraryScansFactory({ libraryRepository, scanRunRepository }),
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
    },
  })
}
