import { appError, type AppError, err, ok, type Result } from '@projo/shared'
import type { AccountRole } from '@projo/shared/api/auth'
import type { AvatarColor, UiLocale } from '@projo/shared/api/profiles'

import type { AccountActivity, AccountActivityQuery } from '../../core/account/activity.ts'
import { removesLastAdmin } from '../../core/account/last-admin.ts'
import type { Account, AccountRepository } from '../../core/auth/account.ts'
import type { PasswordHasher } from '../../core/auth/ports.ts'
import type { SessionRepository } from '../../core/auth/session.ts'
import type { Clock } from '../../core/clock.ts'
import type { IdGenerator } from '../../core/ids.ts'
import type { Logger } from '../../core/logger.ts'
import type { PlaybackSessionTerminator } from '../../core/playback/session.ts'
import { newProfile, type Profile, type ProfileRepository } from '../../core/profile/profile.ts'

type Deps = {
  accountRepository: AccountRepository
  profileRepository: ProfileRepository
  sessionRepository: SessionRepository
  accountActivity: AccountActivityQuery
  passwordHasher: PasswordHasher
  playbackSessions: PlaybackSessionTerminator
  clock: Clock
  ids: IdGenerator
  logger: Logger
}

/** An account as the admin list shows it (§15 Comptes, artboard `AdminAccounts`). */
export type AdminAccountView = {
  account: Account
  profiles: Profile[]
  activity: AccountActivity
}

export type NewAccountInput = {
  username: string
  password: string
  role: AccountRole
  uiLocale: UiLocale
  profileName?: string
  avatarColor?: AvatarColor
}

type NotFound = AppError<'account/not_found'>
export type CreateAccountError = AppError<'auth/username_taken'>
export type UpdateAccountError = NotFound | AppError<'account/last_admin'>
export type DeleteAccountError =
  NotFound | AppError<'account/last_admin' | 'account/confirmation_mismatch'>

const notFound = (accountId: string) =>
  err(appError('account/not_found', 'account not found', { context: { accountId } }))

const lastAdmin = (accountId: string) =>
  err(
    appError(
      'account/last_admin',
      'the last enabled admin cannot be demoted, disabled or deleted',
      {
        context: { accountId },
      },
    ),
  )

/** Builds an account and its first profile (§14): name = username unless given. */
export const buildNewAccount = async (
  { passwordHasher, ids, clock }: Pick<Deps, 'passwordHasher' | 'ids' | 'clock'>,
  input: NewAccountInput,
): Promise<{ account: Account; profile: Profile }> => {
  const now = clock.now()
  const account: Account = {
    id: ids.next(),
    username: input.username,
    passwordHash: await passwordHasher.hash(input.password),
    role: input.role,
    createdAt: now,
  }
  const profile = newProfile({
    id: ids.next(),
    accountId: account.id,
    name: input.profileName ?? input.username,
    avatarColor: input.avatarColor ?? 'blue',
    uiLocale: input.uiLocale,
    createdAt: now,
  })
  return { account, profile }
}

/** Use cases of `/admin/accounts` (§15 Accounts). Every caller is an admin (`requireAdmin`). */
export const adminAccountsFactory = (deps: Deps) => {
  const {
    accountRepository,
    profileRepository,
    sessionRepository,
    accountActivity,
    passwordHasher,
    playbackSessions,
    clock,
    logger,
  } = deps

  const viewsOf = (accounts: Account[]): AdminAccountView[] => {
    const activity = accountActivity({ now: clock.now() })
    return accounts.map((account) => ({
      account,
      profiles: profileRepository.listByAccount(account.id),
      activity: activity.get(account.id) ?? {
        accountId: account.id,
        activeSessions: 0,
        playingProfileIds: [],
      },
    }))
  }

  const get = (accountId: string): Result<AdminAccountView, NotFound> => {
    const account = accountRepository.findById(accountId)
    if (account === undefined) return notFound(accountId)
    const [view] = viewsOf([account])
    return view === undefined ? notFound(accountId) : ok(view)
  }

  const revokeAll = (accountId: string) =>
    sessionRepository.revokeAllByAccount({ accountId, revokedAt: clock.now() })

  return {
    list: (): AdminAccountView[] => viewsOf(accountRepository.list()),

    get,

    create: async (
      input: NewAccountInput,
    ): Promise<Result<AdminAccountView, CreateAccountError | NotFound>> => {
      if (accountRepository.findByUsername(input.username) !== undefined) {
        return err(
          appError('auth/username_taken', 'username already used', {
            context: { username: input.username },
          }),
        )
      }
      const created = await buildNewAccount(deps, input)
      if (accountRepository.create(created) === 'username_taken') {
        return err(
          appError('auth/username_taken', 'username already used', {
            context: { username: input.username },
          }),
        )
      }
      logger.info('account created', { accountId: created.account.id, role: input.role })
      return get(created.account.id)
    },

    /**
     * Role and activation. Disabling revokes every session (the account cannot sign in any more,
     * its data stays, §14). Synchronous from the last-admin check to the write: two admins
     * demoting each other cannot both pass.
     */
    update: ({
      accountId,
      role,
      disabled,
    }: {
      accountId: string
      role?: AccountRole
      disabled?: boolean
    }): Result<AdminAccountView, UpdateAccountError> => {
      const account = accountRepository.findById(accountId)
      if (account === undefined) return notFound(accountId)
      const demotes = role === 'user' && account.role === 'admin'
      const disables = disabled === true && account.disabledAt === undefined
      if (
        (demotes || disables) &&
        removesLastAdmin({ target: account, enabledAdmins: accountRepository.countEnabledAdmins() })
      ) {
        return lastAdmin(accountId)
      }
      if (role !== undefined && role !== account.role) {
        accountRepository.setRole({ id: accountId, role })
      }
      if (disables) {
        accountRepository.setDisabled({ id: accountId, disabledAt: clock.now() })
        revokeAll(accountId)
        playbackSessions.endWithin({ accountId })
        logger.info('account disabled', { accountId })
      }
      if (disabled === false && account.disabledAt !== undefined) {
        accountRepository.setDisabled({ id: accountId, disabledAt: undefined })
        logger.info('account enabled', { accountId })
      }
      return get(accountId)
    },

    /** Full cascade (§14), confirmed by typing the username. */
    delete: ({
      accountId,
      confirmUsername,
    }: {
      accountId: string
      confirmUsername: string
    }): Result<void, DeleteAccountError> => {
      const account = accountRepository.findById(accountId)
      if (account === undefined) return notFound(accountId)
      if (confirmUsername.trim().toLowerCase() !== account.username.toLowerCase()) {
        return err(
          appError('account/confirmation_mismatch', 'typed username does not match', {
            context: { accountId },
          }),
        )
      }
      if (
        removesLastAdmin({ target: account, enabledAdmins: accountRepository.countEnabledAdmins() })
      ) {
        return lastAdmin(accountId)
      }
      // Its playback stops first (ffmpeg, players told): the cascade drops the session rows.
      playbackSessions.endWithin({ accountId })
      accountRepository.delete(accountId)
      logger.info('account deleted', { accountId })
      return ok()
    },

    /** §14 "the admin resets it": new password, every session of the account revoked. */
    resetPassword: async ({
      accountId,
      password,
    }: {
      accountId: string
      password: string
    }): Promise<Result<void, NotFound>> => {
      if (accountRepository.findById(accountId) === undefined) return notFound(accountId)
      accountRepository.setPasswordHash({
        id: accountId,
        passwordHash: await passwordHasher.hash(password),
      })
      revokeAll(accountId)
      logger.info('password reset by admin', { accountId })
      return ok()
    },

    revokeSessions: ({ accountId }: { accountId: string }): Result<void, NotFound> => {
      if (accountRepository.findById(accountId) === undefined) return notFound(accountId)
      revokeAll(accountId)
      logger.info('sessions revoked by admin', { accountId })
      return ok()
    },
  }
}

export type AdminAccounts = ReturnType<typeof adminAccountsFactory>
