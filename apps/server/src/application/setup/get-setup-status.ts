import { settingKeys, type SettingsRepository } from '../../core/settings/settings.ts'
import type { SetupRepository } from '../../core/setup/setup.ts'

type Deps = {
  setupRepository: SetupRepository
  settingsRepository: SettingsRepository
}

/** `GET /setup/status`: whether the first-launch wizard is closed, and the server name. */
export const getSetupStatusFactory =
  ({ setupRepository, settingsRepository }: Deps) =>
  (): { completed: boolean; serverName?: string } => {
    const serverName = settingsRepository.get(settingKeys.serverName)
    return {
      completed: setupRepository.isCompleted(),
      ...(typeof serverName === 'string' ? { serverName } : {}),
    }
  }

export type GetSetupStatus = ReturnType<typeof getSetupStatusFactory>
