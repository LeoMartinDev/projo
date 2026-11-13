import type { SessionTokens } from '../../core/auth/ports.ts'
import type { Clock } from '../../core/clock.ts'
import type { IdGenerator } from '../../core/ids.ts'
import {
  type Invitation,
  invitationLifetimeMs,
  type InvitationListing,
  type InvitationRepository,
} from '../../core/invitation/invitation.ts'
import type { Logger } from '../../core/logger.ts'

type Deps = {
  invitationRepository: Pick<InvitationRepository, 'create' | 'findById'>
  tokens: SessionTokens
  clock: Clock
  ids: IdGenerator
  logger: Logger
}

export const createInvitationFactory =
  ({ invitationRepository, tokens, clock, ids, logger }: Deps) =>
  ({ createdBy }: { createdBy: string }): { invitation: InvitationListing; token: string } => {
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
  }

export type CreateInvitation = ReturnType<typeof createInvitationFactory>
