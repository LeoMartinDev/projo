import { listSourcesFactory } from '../../application/scanner/list-sources.ts'
import { recheckSourceFactory } from '../../application/scanner/recheck-source.ts'
import { createSqliteSourceRepository } from '../../infrastructure/sqlite/source-repository.ts'
import { adminSourcesRoutes } from '../http/routes/admin-sources.ts'
import type { Platform } from './platform.ts'
import { defineModule } from './types.ts'

export const buildSourcesModule = ({ db, ids, jobQueue }: Platform) => {
  const sourceRepository = createSqliteSourceRepository({ db, ids })
  return defineModule({
    exposes: {
      routes: adminSourcesRoutes({
        listSources: listSourcesFactory({ sourceRepository }),
        recheckSource: recheckSourceFactory({ sourceRepository, jobQueue }),
      }),
    },
  })
}
