import { err, ok, type Result } from '@projo/shared'

import type { SessionTokens } from '../../core/auth/ports.ts'
import type { Clock } from '../../core/clock.ts'
import {
  type Invitation,
  type InvitationRepository,
  invitationState,
} from '../../core/invitation/invitation.ts'
import { type InvitationLookupError, lookupError } from './shared/invitation-lookup.ts'

type Deps = {
  invitationRepository: Pick<InvitationRepository, 'findByTokenHash'>
  tokens: SessionTokens
  clock: Clock
}

export const checkInvitationFactory =
  ({ invitationRepository, tokens, clock }: Deps) =>
  ({ token }: { token: string }): Result<Invitation, InvitationLookupError> => {
    const invitation = invitationRepository.findByTokenHash(tokens.hash(token))
    if (invitation === undefined) return err(lookupError('not_found'))
    const state = invitationState(invitation, clock.now())
    return state === 'pending' ? ok(invitation) : err(lookupError(state))
  }

export type CheckInvitation = ReturnType<typeof checkInvitationFactory>
