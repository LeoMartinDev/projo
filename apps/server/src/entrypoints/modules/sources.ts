import { sourceAdminFactory } from '../../application/scanner/source-admin.ts'
import { createSqliteSourceRepository } from '../../infrastructure/sqlite/source-repository.ts'
import { adminSourcesRoutes } from '../http/routes/admin-sources.ts'
import type { Platform } from './platform.ts'
import { defineModule } from './types.ts'

export const buildSourcesModule = ({ db, ids, jobQueue }: Platform) =>
  defineModule({
    exposes: {
      routes: adminSourcesRoutes({
        sourceAdmin: sourceAdminFactory({
          sourceRepository: createSqliteSourceRepository({ db, ids }),
          jobQueue,
        }),
      }),
    },
  })
