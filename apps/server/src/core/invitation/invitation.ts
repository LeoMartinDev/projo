import type { InvitationState } from '@projo/shared/api/invitations'

import type { Account } from '../auth/account.ts'
import type { Profile } from '../profile/profile.ts'

/** §6.1 `invitations`: single-use link, only the token hash is stored (§14). */
export type Invitation = {
  id: string
  tokenHash: string
  /** Absent once the admin who created it was deleted (the history stays). */
  createdBy?: string
  expiresAt: Date
  usedAt?: Date
  usedByAccountId?: string
}

/** An invitation with the usernames the admin list shows. */
export type InvitationListing = Invitation & {
  createdByUsername?: string
  usedByUsername?: string
}

export type AcceptOutcome = 'accepted' | 'not_found' | 'expired' | 'used' | 'username_taken'

export type InvitationRepository = {
  create: (invitation: Invitation) => void
  findByTokenHash: (tokenHash: string) => Invitation | undefined
  findById: (id: string) => InvitationListing | undefined
  /** Most recent first. */
  list: () => InvitationListing[]
  delete: (id: string) => void
  /**
   * Atomic: re-checks the invitation, creates the account and its first profile, marks the
   * invitation used. Nothing is written unless the outcome is `accepted`.
   */
  accept: (input: {
    tokenHash: string
    account: Account
    profile: Profile
    at: Date
  }) => AcceptOutcome
}

/** §14: 7 days. */
export const invitationLifetimeMs = 7 * 24 * 60 * 60_000

export const invitationState = (invitation: Invitation, now: Date): InvitationState => {
  if (invitation.usedAt !== undefined) return 'used'
  if (invitation.expiresAt.getTime() <= now.getTime()) return 'expired'
  return 'pending'
}
