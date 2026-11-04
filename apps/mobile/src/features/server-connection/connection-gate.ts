import type { Failure } from '../../shared/api/failure.ts'
import type { ServerStatus } from './check-server.ts'

export type ConnectionGate =
  | { readonly kind: 'loading' }
  | { readonly kind: 'disconnected'; readonly url?: string; readonly error?: Failure }
  | {
      readonly kind: 'outdated'
      readonly url: string
      readonly version: string
      readonly minimumVersion: string
    }
  | { readonly kind: 'connected'; readonly url: string; readonly version: string }

export type ConnectionGateInput = {
  readonly stored: { readonly loaded: boolean; readonly url?: string | undefined }
  readonly health: {
    readonly status?: ServerStatus | undefined
    readonly error?: Failure | undefined
  }
}

export const connectionGate = ({ stored, health }: ConnectionGateInput): ConnectionGate => {
  if (!stored.loaded) return { kind: 'loading' }
  const { url } = stored
  if (url === undefined) return { kind: 'disconnected' }
  const { status, error } = health
  if (status?.kind === 'outdated')
    return { kind: 'outdated', url, version: status.version, minimumVersion: status.minimumVersion }
  if (status?.kind === 'compatible') return { kind: 'connected', url, version: status.version }
  if (error !== undefined) return { kind: 'disconnected', url, error }
  return { kind: 'loading' }
}
