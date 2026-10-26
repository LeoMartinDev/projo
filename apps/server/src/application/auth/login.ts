import { appError, type AppError, err, ok, type Result } from '@projo/shared'
import type { SessionKind } from '@projo/shared/api/auth'

import { type Account, type AccountRepository } from '../../core/auth/account.ts'
import type { PasswordHasher, RateLimiter } from '../../core/auth/ports.ts'
import type { Session } from '../../core/auth/session.ts'
import { describeUserAgent } from '../../core/auth/user-agent.ts'
import type { Logger } from '../../core/logger.ts'
import type { ProfileRepository } from '../../core/profile/profile.ts'
import type { OpenSession } from './open-session.ts'

type Deps = {
  accountRepository: AccountRepository
  profileRepository: ProfileRepository
  passwordHasher: PasswordHasher
  /** §20: 10 attempts per 15 min, keyed by IP and by username. */
  rateLimiter: RateLimiter
  openSession: OpenSession
  logger: Logger
}

export type LoginInput = {
  username: string
  password: string
  ip: string
  userAgent: string
  deviceName?: string
  /** `bearer`: a token for the mobile app (`token: true`, §14). Default `cookie`. */
  kind?: SessionKind
}

export type LoginError = AppError<
  'auth/invalid_credentials' | 'auth/rate_limited' | 'auth/account_disabled'
>

export const loginRateLimitKeys = ({ ip, username }: { ip: string; username: string }) => ({
  ip: `login:ip:${ip}`,
  username: `login:user:${username.toLowerCase()}`,
})

/**
 * Checks the credentials and opens a cookie session (or a bearer one). Every attempt counts against both the IP
 * and the username (§20); a success clears the username counter. An unknown username costs the
 * same argon2 verification as a known one.
 * A disabled account is reported only once the password is proven.
 */
export const loginFactory = ({
  accountRepository,
  profileRepository,
  passwordHasher,
  rateLimiter,
  openSession,
  logger,
}: Deps) => {
  // Verified against when the username does not exist, so timing does not reveal accounts.
  let decoyHash: Promise<string> | undefined
  const decoy = () => (decoyHash ??= passwordHasher.hash('projo-decoy-password'))

  return async ({
    username,
    password,
    ip,
    userAgent,
    deviceName,
    kind = 'cookie',
  }: LoginInput): Promise<
    Result<{ token: string; session: Session; account: Account }, LoginError>
  > => {
    const keys = loginRateLimitKeys({ ip, username })
    const retryAfterMs = Math.max(
      rateLimiter.blockedFor(keys.ip) ?? 0,
      rateLimiter.blockedFor(keys.username) ?? 0,
    )
    if (retryAfterMs > 0) {
      logger.warn('login rate limited', { code: 'auth/rate_limited', ip })
      return err(
        appError('auth/rate_limited', 'too many login attempts', {
          context: { retryAfterSeconds: Math.ceil(retryAfterMs / 1000) },
        }),
      )
    }
    // Consumed before the (slow) password check: checking and counting with no `await` in
    // between keeps parallel attempts from all passing the gate before any of them is counted.
    rateLimiter.hit(keys.ip)
    rateLimiter.hit(keys.username)

    const account = accountRepository.findByUsername(username)
    const valid =
      account === undefined
        ? await passwordHasher.verify(password, await decoy()).then(() => false)
        : await passwordHasher.verify(password, account.passwordHash)
    if (account === undefined || !valid) {
      logger.info('login failed', { code: 'auth/invalid_credentials', ip })
      return err(appError('auth/invalid_credentials', 'invalid username or password'))
    }
    if (account.disabledAt !== undefined) {
      return err(
        appError('auth/account_disabled', 'account is disabled', {
          context: { accountId: account.id },
        }),
      )
    }

    rateLimiter.reset(keys.username)
    const profiles = profileRepository.listByAccount(account.id)
    const onlyProfile = profiles.length === 1 ? profiles[0]?.id : undefined
    const { token, session } = openSession({
      accountId: account.id,
      kind,
      deviceName: deviceName ?? describeUserAgent(userAgent),
      userAgent,
      ...(onlyProfile === undefined ? {} : { lastProfileId: onlyProfile }),
    })
    logger.info('login succeeded', { accountId: account.id, sessionId: session.id })
    return ok({ token, session, account })
  }
}

export type Login = ReturnType<typeof loginFactory>
