import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { Account } from '../../core/auth/account.ts'
import type { RateLimiter, SessionTokens } from '../../core/auth/ports.ts'
import type { PasswordHasher } from '../../core/auth/ports.ts'
import type { Clock } from '../../core/clock.ts'
import type { IdGenerator } from '../../core/ids.ts'
import {
  type Invitation,
  invitationLifetimeMs,
  type InvitationListing,
  type InvitationRepository,
  invitationState,
} from '../../core/invitation/invitation.ts'
import type { Logger } from '../../core/logger.ts'
import type { Profile } from '../../core/profile/profile.ts'
import { buildNewAccount, type NewAccountInput } from '../account/admin-accounts.ts'

type Deps = {
  invitationRepository: InvitationRepository
  /** Opaque single-use tokens, stored hashed (same generator as sessions). */
  tokens: SessionTokens
  passwordHasher: PasswordHasher
  /** §20: 20 acceptances per hour per IP. */
  rateLimiter: RateLimiter
  clock: Clock
  ids: IdGenerator
  logger: Logger
}

export type InvitationLookupError = AppError<
  'auth/invitation_invalid' | 'auth/invitation_expired' | 'auth/invitation_used'
>
export type AcceptInvitationError =
  InvitationLookupError | AppError<'auth/username_taken' | 'auth/rate_limited'>

const lookupError = (outcome: 'not_found' | 'expired' | 'used'): InvitationLookupError => {
  switch (outcome) {
    case 'not_found':
      return appError('auth/invitation_invalid', 'unknown invitation')
    case 'expired':
      return appError('auth/invitation_expired', 'invitation expired')
    case 'used':
      return appError('auth/invitation_used', 'invitation already used')
  }
}

export const invitationRateLimitKey = (ip: string) => `invitation:ip:${ip}`

/** §14 Invitations: admin side (create, list, withdraw) and public side (check, accept). */
export const invitationsFactory = ({
  invitationRepository,
  tokens,
  passwordHasher,
  rateLimiter,
  clock,
  ids,
  logger,
}: Deps) => ({
  /** The token is returned this once; only its hash is stored. */
  create: ({
    createdBy,
  }: {
    createdBy: string
  }): { invitation: InvitationListing; token: string } => {
    const token = tokens.generate()
    const invitation: Invitation = {
      id: ids.next(),
      tokenHash: tokens.hash(token),
      createdBy,
      expiresAt: new Date(clock.now().getTime() + invitationLifetimeMs),
    }
    invitationRepository.create(invitation)
    logger.info('invitation created', { invitationId: invitation.id, accountId: createdBy })
    const listing = invitationRepository.findById(invitation.id)
    if (listing === undefined) throw new Error(`invitation ${invitation.id} vanished`)
    return { invitation: listing, token }
  },

  list: (): InvitationListing[] => invitationRepository.list(),

  delete: ({ id }: { id: string }): Result<void, AppError<'auth/invitation_invalid'>> => {
    if (invitationRepository.findById(id) === undefined) {
      return err(appError('auth/invitation_invalid', 'unknown invitation', { context: { id } }))
    }
    invitationRepository.delete(id)
    logger.info('invitation deleted', { invitationId: id })
    return ok()
  },

  /** `GET /invitations/:token`: whether the link can still be used. */
  check: ({ token }: { token: string }): Result<Invitation, InvitationLookupError> => {
    const invitation = invitationRepository.findByTokenHash(tokens.hash(token))
    if (invitation === undefined) return err(lookupError('not_found'))
    const state = invitationState(invitation, clock.now())
    return state === 'pending' ? ok(invitation) : err(lookupError(state))
  },

  /**
   * Creates a `user` account and its first profile from a pending invitation, atomically with
   * marking it used (two parallel acceptances cannot both succeed).
   */
  accept: async ({
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
  },
})

export type Invitations = ReturnType<typeof invitationsFactory>
