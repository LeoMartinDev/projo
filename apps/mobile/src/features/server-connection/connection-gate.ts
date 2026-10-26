import type { Failure } from '../../shared/api/failure.ts'
import type { ServerStatus } from './check-server.ts'

/** Which screen the app shows, from the stored server URL and the last health check (§26.4). */
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
  /** `loaded: false` while the URL is read from the device. */
  readonly stored: { readonly loaded: boolean; readonly url?: string | undefined }
  /** The last successful check of that URL, and the error of the last one if it failed. */
  readonly health: {
    readonly status?: ServerStatus | undefined
    readonly error?: Failure | undefined
  }
}

/**
 * A server that answered once stays the reference: a failed re-check (foreground with no network)
 * keeps the user where they are. Never reached: back to the connection screen, URL kept.
 */
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
