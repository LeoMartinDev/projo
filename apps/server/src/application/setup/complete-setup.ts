import { appError, type AppError, err, ok, type Result } from '@projo/shared'
import type { AvatarColor, UiLocale } from '@projo/shared/api/auth'

import type { Account } from '../../core/auth/account.ts'
import type { PasswordHasher } from '../../core/auth/ports.ts'
import type { Clock } from '../../core/clock.ts'
import type { IdGenerator } from '../../core/ids.ts'
import type { Logger } from '../../core/logger.ts'
import { newProfile, type Profile } from '../../core/profile/profile.ts'
import { settingKeys } from '../../core/settings/settings.ts'
import type { SetupRepository } from '../../core/setup/setup.ts'

type Deps = {
  setupRepository: SetupRepository
  passwordHasher: PasswordHasher
  clock: Clock
  ids: IdGenerator
  logger: Logger
}

export type CompleteSetupInput = {
  username: string
  password: string
  serverName: string
  metadataLanguage: string
  uiLocale: UiLocale
  profileName?: string
  avatarColor?: AvatarColor
}

export type CompleteSetupError = AppError<'setup/already_completed'>

/**
 * First launch (§14, §15): creates the admin account, its first profile and the server
 * settings. Refused as soon as an account exists, including when two requests race.
 */
export const completeSetupFactory =
  ({ setupRepository, passwordHasher, clock, ids, logger }: Deps) =>
  async ({
    username,
    password,
    serverName,
    metadataLanguage,
    uiLocale,
    profileName,
    avatarColor,
  }: CompleteSetupInput): Promise<
    Result<{ account: Account; profile: Profile }, CompleteSetupError>
  > => {
    const alreadyCompleted = () =>
      err(appError('setup/already_completed', 'setup already completed'))
    if (setupRepository.isCompleted()) return alreadyCompleted()

    const passwordHash = await passwordHasher.hash(password)
    const now = clock.now()
    const account: Account = {
      id: ids.next(),
      username,
      passwordHash,
      role: 'admin',
      createdAt: now,
    }
    const profile = newProfile({
      id: ids.next(),
      accountId: account.id,
      name: profileName ?? username,
      avatarColor: avatarColor ?? 'blue',
      uiLocale,
      createdAt: now,
    })
    const outcome = setupRepository.complete({
      account,
      profile,
      settings: {
        [settingKeys.serverName]: serverName,
        [settingKeys.metadataLanguage]: metadataLanguage,
      },
      at: now,
    })
    if (outcome === 'already_completed') return alreadyCompleted()

    logger.info('setup completed', { accountId: account.id, profileId: profile.id })
    return ok({ account, profile })
  }

export type CompleteSetup = ReturnType<typeof completeSetupFactory>
