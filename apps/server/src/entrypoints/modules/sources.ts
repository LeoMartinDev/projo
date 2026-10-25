import { sourceAdminFactory } from '../../application/scanner/source-admin.ts'
import { createSqliteSourceRepository } from '../../infrastructure/sqlite/source-repository.ts'
import { adminSourcesRoutes } from '../http/routes/admin-sources.ts'
import type { Platform } from './platform.ts'

/** Wiring of the admin view of sources (states, pending reasons) and the re-check action. */
export const buildSourcesModule = ({ db, ids, jobQueue }: Platform) => ({
  routes: adminSourcesRoutes({
    sourceAdmin: sourceAdminFactory({
      sourceRepository: createSqliteSourceRepository({ db, ids }),
      jobQueue,
    }),
  }),
})
