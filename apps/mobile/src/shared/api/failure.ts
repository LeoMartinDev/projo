import { type ErrorCode, isErrorCode } from '@projo/shared/errors'

export const appFailureCodes = [
  'connection/invalid_url',
  'connection/not_projo',
  'pairing/not_a_code',
] as const
export type AppFailureCode = (typeof appFailureCodes)[number]

export type FailureCode = ErrorCode | AppFailureCode | 'network' | 'unknown'

export type Failure<Code extends FailureCode = FailureCode> = {
  readonly code: Code
  readonly message: string
  readonly status?: number
  readonly context?: Record<string, unknown>
  readonly cause?: unknown
}

export const failure = <Code extends FailureCode>(
  code: Code,
  message: string,
  extras: { status?: number; context?: Record<string, unknown>; cause?: unknown } = {},
): Failure<Code> => ({
  code,
  message,
  ...(extras.status === undefined ? {} : { status: extras.status }),
  ...(extras.context === undefined ? {} : { context: extras.context }),
  ...(extras.cause === undefined ? {} : { cause: extras.cause }),
})

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && Object(value) === value

const appCodes: ReadonlySet<string> = new Set(appFailureCodes)

export const isFailureCode = (value: string): value is FailureCode =>
  isErrorCode(value) || appCodes.has(value) || value === 'network' || value === 'unknown'

export const toFailure = (value: unknown): Failure =>
  isRecord(value) && typeof value['code'] === 'string' && isFailureCode(value['code'])
    ? (value as Failure)
    : failure('unknown', value instanceof Error ? value.message : String(value), { cause: value })

export const failureFromBody = (status: number, body: unknown): Failure => {
  const error = isRecord(body) ? body['error'] : undefined
  if (!isRecord(error)) return failure('unknown', `HTTP ${status}`, { status })
  const code = typeof error['code'] === 'string' ? error['code'] : ''
  const message = typeof error['message'] === 'string' ? error['message'] : `HTTP ${status}`
  const context = isRecord(error['context']) ? error['context'] : undefined
  return failure(isErrorCode(code) ? code : 'unknown', message, {
    status,
    ...(context === undefined ? {} : { context }),
  })
}
