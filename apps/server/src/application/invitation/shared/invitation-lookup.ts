import { appError, type AppError } from '@projo/shared'

export type InvitationLookupError = AppError<
  'auth/invitation_invalid' | 'auth/invitation_expired' | 'auth/invitation_used'
>

export const lookupError = (outcome: 'not_found' | 'expired' | 'used'): InvitationLookupError => {
  switch (outcome) {
    case 'not_found':
      return appError('auth/invitation_invalid', 'unknown invitation')
    case 'expired':
      return appError('auth/invitation_expired', 'invitation expired')
    case 'used':
      return appError('auth/invitation_used', 'invitation already used')
  }
}
