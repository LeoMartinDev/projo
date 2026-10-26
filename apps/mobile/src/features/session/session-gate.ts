import type { MeResponse } from '@projo/shared/api/auth'
import type { ProfileDto } from '@projo/shared/api/profiles'

import type { Failure } from '../../shared/api/failure.ts'

/** Which screen a connected app shows, from the device's token and `GET /auth/me` (§26.3, §13.6). */
export type SessionGate =
  | { readonly kind: 'loading' }
  | { readonly kind: 'signed_out' }
  /** The account could not be read and nothing is known yet: retry, or sign out. */
  | { readonly kind: 'error'; readonly error: Failure }
  /** "Who's watching?": no profile resolved yet, or the user asked to switch. */
  | { readonly kind: 'choosing'; readonly me: MeResponse; readonly switching: boolean }
  | { readonly kind: 'ready'; readonly me: MeResponse; readonly profile: ProfileDto }

export type SessionGateInput = {
  /** `loaded: false` while the token is read from the Keychain. */
  readonly stored: { readonly loaded: boolean; readonly token?: string | undefined }
  /** The last `GET /auth/me` answer, and the error of the last attempt if it failed. */
  readonly me: { readonly data?: MeResponse | undefined; readonly error?: Failure | undefined }
  /** "Switch profile" was asked from a ready session. */
  readonly switching: boolean
}

/**
 * The server resolves the active profile (§13.6: the only one, else the one this device used last);
 * otherwise "Who's watching?". A failed refresh keeps the last answer (foreground without network);
 * a lost session is a missing token, cleared on any 401.
 */
export const sessionGate = ({ stored, me, switching }: SessionGateInput): SessionGate => {
  if (!stored.loaded) return { kind: 'loading' }
  if (stored.token === undefined) return { kind: 'signed_out' }
  const { data, error } = me
  if (data === undefined)
    return error === undefined ? { kind: 'loading' } : { kind: 'error', error }
  const profile = data.profiles.find(({ id }) => id === data.activeProfileId)
  if (switching || data.needsProfileSelection || profile === undefined)
    return { kind: 'choosing', me: data, switching: switching && profile !== undefined }
  return { kind: 'ready', me: data, profile }
}
