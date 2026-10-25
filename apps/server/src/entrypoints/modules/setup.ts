import { completeSetupFactory } from '../../application/setup/complete-setup.ts'
import { getSetupStatusFactory } from '../../application/setup/get-setup-status.ts'
import { createSqliteSettingsRepository } from '../../infrastructure/sqlite/settings-repository.ts'
import { createSqliteSetupRepository } from '../../infrastructure/sqlite/setup-repository.ts'
import { setupRoutes } from '../http/routes/setup.ts'
import { buildAuthServices } from './auth.ts'
import type { Platform } from './platform.ts'

/** Wiring of the first-launch wizard (§15): admin account, first profile, server settings. */
export const buildSetupModule = (platform: Platform) => {
  const { db, clock, ids, logger, config } = platform
  const { passwordHasher, openSession, getMe } = buildAuthServices(platform)
  const setupRepository = createSqliteSetupRepository({ db })
  return {
    routes: setupRoutes({
      getSetupStatus: getSetupStatusFactory({
        setupRepository,
        settingsRepository: createSqliteSettingsRepository({ db }),
      }),
      completeSetup: completeSetupFactory({ setupRepository, passwordHasher, clock, ids, logger }),
      openSession,
      getMe,
      clock,
      trustProxy: config.trustProxy,
    }),
  }
}
