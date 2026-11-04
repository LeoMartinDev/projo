import type { InvitationState } from '@projo/shared/api/invitations'

import type { Account } from '../auth/account.ts'
import type { Profile } from '../profile/profile.ts'

export type Invitation = {
  id: string
  tokenHash: string
  createdBy?: string
  expiresAt: Date
  usedAt?: Date
  usedByAccountId?: string
}

export type InvitationListing = Invitation & {
  createdByUsername?: string
  usedByUsername?: string
}

export type AcceptOutcome = 'accepted' | 'not_found' | 'expired' | 'used' | 'username_taken'

export type InvitationRepository = {
  create: (invitation: Invitation) => void
  findByTokenHash: (tokenHash: string) => Invitation | undefined
  findById: (id: string) => InvitationListing | undefined
  list: () => InvitationListing[]
  delete: (id: string) => void
  accept: (input: {
    tokenHash: string
    account: Account
    profile: Profile
    at: Date
  }) => AcceptOutcome
}

export const invitationLifetimeMs = 7 * 24 * 60 * 60_000

export const invitationState = (invitation: Invitation, now: Date): InvitationState => {
  if (invitation.usedAt !== undefined) return 'used'
  if (invitation.expiresAt.getTime() <= now.getTime()) return 'expired'
  return 'pending'
}
