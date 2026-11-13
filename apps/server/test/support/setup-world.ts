import { completeSetupFactory } from '../../src/application/setup/complete-setup.ts'
import { getSetupStatusFactory } from '../../src/application/setup/get-setup-status.ts'
import type { SettingsRepository } from '../../src/core/settings/settings.ts'
import { createFakePasswordHasher, createInMemorySetup } from './auth.ts'
import { createManualClock } from './clock.ts'
import { createSequentialIds } from './fakes.ts'
import { silentLogger } from './logger.ts'

export const setupInput = {
  username: 'leo',
  password: 'correct horse battery',
  serverName: 'Maison',
  metadataLanguage: 'fr-FR',
  uiLocale: 'fr' as const,
}

/** The first-run setup use cases on an in-memory server with no account yet. */
export const createSetupWorld = () => {
  const setup = createInMemorySetup()
  const settingsRepository: SettingsRepository = { get: (key) => setup.state.settings.get(key) }
  return {
    setup,
    completeSetup: completeSetupFactory({
      setupRepository: setup.repository,
      passwordHasher: createFakePasswordHasher().hasher,
      clock: createManualClock(),
      ids: createSequentialIds(),
      logger: silentLogger,
    }),
    getSetupStatus: getSetupStatusFactory({
      setupRepository: setup.repository,
      settingsRepository,
    }),
  }
}
