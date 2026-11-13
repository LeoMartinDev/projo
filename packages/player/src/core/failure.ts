import type { ErrorCode } from '@projo/shared/errors'

// The shape of the clients' API failures (`ApiFailure` of the web and the mobile app).
export type PlayerFailure = {
  readonly kind: 'api_failure'
  readonly status: number
  readonly code: ErrorCode | 'network' | 'unknown'
  readonly message: string
  readonly context?: Record<string, unknown>
}

export const playerFailure = (
  status: number,
  code: PlayerFailure['code'],
  message: string,
): PlayerFailure => ({ kind: 'api_failure', status, code, message })

const isFailure = (value: unknown): value is PlayerFailure =>
  typeof value === 'object' &&
  Object(value) === value &&
  (value as Record<string, unknown>)['kind'] === 'api_failure'

export const toPlayerFailure = (value: unknown): PlayerFailure =>
  isFailure(value)
    ? value
    : playerFailure(0, 'unknown', value instanceof Error ? value.message : String(value))
