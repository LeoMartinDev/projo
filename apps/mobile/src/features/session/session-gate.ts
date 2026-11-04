import type { MeResponse } from '@projo/shared/api/auth'
import type { ProfileDto } from '@projo/shared/api/profiles'

import type { Failure } from '../../shared/api/failure.ts'

export type SessionGate =
  | { readonly kind: 'loading' }
  | { readonly kind: 'signed_out' }
  | { readonly kind: 'error'; readonly error: Failure }
  | { readonly kind: 'choosing'; readonly me: MeResponse; readonly switching: boolean }
  | { readonly kind: 'ready'; readonly me: MeResponse; readonly profile: ProfileDto }

export type SessionGateInput = {
  readonly stored: { readonly loaded: boolean; readonly token?: string | undefined }
  readonly me: { readonly data?: MeResponse | undefined; readonly error?: Failure | undefined }
  readonly switching: boolean
}

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
