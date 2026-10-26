import { type ErrorCode, isErrorCode } from '@projo/shared/errors'

/** The app's own codes, for what fails before or outside an API call; translated under `mobile.errors`. */
export const appFailureCodes = [
  'connection/invalid_url',
  'connection/not_projo',
  'pairing/not_a_code',
] as const
export type AppFailureCode = (typeof appFailureCodes)[number]

/**
 * `ErrorCode`: the server's stable `domain/reason` (§17.1); `network` when the server could not be
 * reached, `unknown` when nothing recognizable came back.
 */
export type FailureCode = ErrorCode | AppFailureCode | 'network' | 'unknown'

/**
 * An expected failure, as the screens see it. Same shape as `AppError` (`@projo/shared`), plus the
 * HTTP `status` of an API answer. `message` is English, for logs; the screen shows the code's
 * translation (`errorKey`).
 */
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

/** Any non-primitive (`Object(x) === x` excludes `null` without naming it, §5.3). */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && Object(value) === value

const appCodes: ReadonlySet<string> = new Set(appFailureCodes)

export const isFailureCode = (value: string): value is FailureCode =>
  isErrorCode(value) || appCodes.has(value) || value === 'network' || value === 'unknown'

/** Whatever a query or mutation failed with, as a `Failure` (`unknown` if foreign). */
export const toFailure = (value: unknown): Failure =>
  isRecord(value) && typeof value['code'] === 'string' && isFailureCode(value['code'])
    ? (value as Failure)
    : failure('unknown', value instanceof Error ? value.message : String(value), { cause: value })

/**
 * Reads the API's `{ error: { code, message, context? } }` (§17.1), tolerant of any other body. A
 * code this app does not know (a newer server) is `unknown`: the generic message.
 */
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
