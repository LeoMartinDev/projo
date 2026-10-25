import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { PasswordHasher, RateLimiter } from '../../core/auth/ports.ts'
import type { Logger } from '../../core/logger.ts'
import type { Profile } from '../../core/profile/profile.ts'

type Deps = {
  passwordHasher: PasswordHasher
  /** §20: 5 checks per minute per profile. */
  rateLimiter: RateLimiter
  logger: Logger
}

export type CheckPinError = AppError<
  'profile/pin_required' | 'profile/invalid_pin' | 'profile/rate_limited'
>

export const pinRateLimitKey = (profileId: string) => `pin:profile:${profileId}`

/**
 * Checks `pin` against a PIN-protected profile. Every check counts (the slot is taken before the
 * slow argon2 verification); a success clears the counter. A profile without PIN always passes.
 */
export const checkPinFactory =
  ({ passwordHasher, rateLimiter, logger }: Deps) =>
  async (profile: Profile, pin: string | undefined): Promise<Result<void, CheckPinError>> => {
    if (profile.pinHash === undefined) return ok()
    if (pin === undefined) {
      return err(
        appError('profile/pin_required', 'this profile is locked by a PIN', {
          context: { profileId: profile.id },
        }),
      )
    }
    const key = pinRateLimitKey(profile.id)
    const retryAfterMs = rateLimiter.blockedFor(key)
    if (retryAfterMs !== undefined) {
      logger.warn('pin rate limited', { code: 'profile/rate_limited', profileId: profile.id })
      return err(
        appError('profile/rate_limited', 'too many PIN attempts', {
          context: { profileId: profile.id, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) },
        }),
      )
    }
    rateLimiter.hit(key)
    if (!(await passwordHasher.verify(pin, profile.pinHash))) {
      return err(
        appError('profile/invalid_pin', 'wrong PIN', { context: { profileId: profile.id } }),
      )
    }
    rateLimiter.reset(key)
    return ok()
  }

export type CheckPin = ReturnType<typeof checkPinFactory>
