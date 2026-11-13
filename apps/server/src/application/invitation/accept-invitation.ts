import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { Account } from '../../core/auth/account.ts'
import type { PasswordHasher, RateLimiter, SessionTokens } from '../../core/auth/ports.ts'
import type { Clock } from '../../core/clock.ts'
import type { IdGenerator } from '../../core/ids.ts'
import { type InvitationRepository, invitationState } from '../../core/invitation/invitation.ts'
import type { Logger } from '../../core/logger.ts'
import type { Profile } from '../../core/profile/profile.ts'
import { buildNewAccount, type NewAccountInput } from '../account/shared/new-account.ts'
import { type InvitationLookupError, lookupError } from './shared/invitation-lookup.ts'

type Deps = {
  invitationRepository: Pick<InvitationRepository, 'findByTokenHash' | 'accept'>
  tokens: SessionTokens
  passwordHasher: PasswordHasher
  rateLimiter: RateLimiter
  clock: Clock
  ids: IdGenerator
  logger: Logger
}

export type AcceptInvitationError =
  InvitationLookupError | AppError<'auth/username_taken' | 'auth/rate_limited'>

export const invitationRateLimitKey = (ip: string) => `invitation:ip:${ip}`

export const acceptInvitationFactory =
  ({ invitationRepository, tokens, passwordHasher, rateLimiter, clock, ids, logger }: Deps) =>
  async ({
    token,
    ip,
    ...input
  }: Omit<NewAccountInput, 'role'> & { token: string; ip: string }): Promise<
    Result<{ account: Account; profile: Profile }, AcceptInvitationError>
  > => {
    const key = invitationRateLimitKey(ip)
    const retryAfterMs = rateLimiter.blockedFor(key)
    if (retryAfterMs !== undefined) {
      logger.warn('invitation acceptance rate limited', { code: 'auth/rate_limited', ip })
      return err(
        appError('auth/rate_limited', 'too many invitation attempts', {
          context: { retryAfterSeconds: Math.ceil(retryAfterMs / 1000) },
        }),
      )
    }
    rateLimiter.hit(key)

    const tokenHash = tokens.hash(token)
    const invitation = invitationRepository.findByTokenHash(tokenHash)
    if (invitation === undefined) return err(lookupError('not_found'))
    const state = invitationState(invitation, clock.now())
    if (state !== 'pending') return err(lookupError(state))

    const created = await buildNewAccount(
      { passwordHasher, ids, clock },
      { ...input, role: 'user' },
    )
    const outcome = invitationRepository.accept({ tokenHash, ...created, at: clock.now() })
    if (outcome === 'username_taken') {
      return err(
        appError('auth/username_taken', 'username already used', {
          context: { username: input.username },
        }),
      )
    }
    if (outcome !== 'accepted') return err(lookupError(outcome))
    logger.info('invitation accepted', {
      invitationId: invitation.id,
      accountId: created.account.id,
    })
    return ok(created)
  }

export type AcceptInvitation = ReturnType<typeof acceptInvitationFactory>
