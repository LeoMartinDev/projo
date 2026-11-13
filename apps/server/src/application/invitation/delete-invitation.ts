import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { InvitationRepository } from '../../core/invitation/invitation.ts'
import type { Logger } from '../../core/logger.ts'

type Deps = {
  invitationRepository: Pick<InvitationRepository, 'findById' | 'delete'>
  logger: Logger
}

export type DeleteInvitationError = AppError<'auth/invitation_invalid'>

export const deleteInvitationFactory =
  ({ invitationRepository, logger }: Deps) =>
  ({ id }: { id: string }): Result<void, DeleteInvitationError> => {
    if (invitationRepository.findById(id) === undefined) {
      return err(appError('auth/invitation_invalid', 'unknown invitation', { context: { id } }))
    }
    invitationRepository.delete(id)
    logger.info('invitation deleted', { invitationId: id })
    return ok()
  }

export type DeleteInvitation = ReturnType<typeof deleteInvitationFactory>
