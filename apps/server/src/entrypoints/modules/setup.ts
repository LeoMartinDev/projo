import { completeSetupFactory } from '../../application/setup/complete-setup.ts'
import { getSetupStatusFactory } from '../../application/setup/get-setup-status.ts'
import { createSqliteSettingsRepository } from '../../infrastructure/sqlite/settings-repository.ts'
import { createSqliteSetupRepository } from '../../infrastructure/sqlite/setup-repository.ts'
import { setupRoutes } from '../http/routes/setup.ts'
import type { AuthServices } from './auth.ts'
import type { Platform } from './platform.ts'
import { defineModule } from './types.ts'

export const buildSetupModule = (
  { db, clock, ids, logger, config }: Platform,
  { authServices }: { authServices: AuthServices },
) => {
  const { passwordHasher, openSession, getMe } = authServices
  const setupRepository = createSqliteSetupRepository({ db })
  return defineModule({
    exposes: {
      routes: setupRoutes({
        getSetupStatus: getSetupStatusFactory({
          setupRepository,
          settingsRepository: createSqliteSettingsRepository({ db }),
        }),
        completeSetup: completeSetupFactory({
          setupRepository,
          passwordHasher,
          clock,
          ids,
          logger,
        }),
        openSession,
        getMe,
        clock,
        trustProxy: config.trustProxy,
      }),
    },
  })
}
