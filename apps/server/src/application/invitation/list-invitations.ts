import type { InvitationListing, InvitationRepository } from '../../core/invitation/invitation.ts'

type Deps = { invitationRepository: Pick<InvitationRepository, 'list'> }

export const listInvitationsFactory =
  ({ invitationRepository }: Deps) =>
  (): InvitationListing[] =>
    invitationRepository.list()

export type ListInvitations = ReturnType<typeof listInvitationsFactory>
