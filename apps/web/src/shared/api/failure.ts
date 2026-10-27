import { type ErrorCode, isErrorCode } from '@projo/shared/errors'

/**
 * A failed API call, as seen by the UI. Plain object (no class, §5.3). `code` is the server's
 * stable `domain/reason`, `network` when the server could not be reached, `unknown` when the
 * response carried no recognizable error body.
 */
export type ApiFailure = {
  readonly kind: 'api_failure'
  readonly status: number
  readonly code: FailureCode
  readonly message: string
  readonly context?: Record<string, unknown>
}

export type FailureCode = ErrorCode | 'network' | 'unknown'

/** Any non-primitive (`Object(x) === x` excludes `null` without naming it, §5.3). */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && Object(value) === value

export const isApiFailure = (value: unknown): value is ApiFailure =>
  isRecord(value) && value['kind'] === 'api_failure'

export const apiFailure = (
  status: number,
  code: FailureCode,
  message: string,
  context?: Record<string, unknown>,
): ApiFailure => ({
  kind: 'api_failure',
  status,
  code,
  message,
  ...(context === undefined ? {} : { context }),
})

export const networkFailure = (cause: unknown): ApiFailure =>
  apiFailure(0, 'network', cause instanceof Error ? cause.message : 'network error')

/** Reads `{ error: { code, message, context? } }` (§17.1); tolerant of any other body. */
export const failureFromBody = (status: number, body: unknown): ApiFailure => {
  const error = isRecord(body) ? body['error'] : undefined
  if (!isRecord(error)) return apiFailure(status, 'unknown', `HTTP ${status}`)
  const code = typeof error['code'] === 'string' ? error['code'] : ''
  const message = typeof error['message'] === 'string' ? error['message'] : `HTTP ${status}`
  const context = isRecord(error['context']) ? error['context'] : undefined
  return apiFailure(status, isErrorCode(code) ? code : 'unknown', message, context)
}

export const failureFromResponse = async (response: {
  status: number
  json: () => Promise<unknown>
}): Promise<ApiFailure> => {
  const body: unknown = await response.json().catch(() => undefined)
  return failureFromBody(response.status, body)
}

/** Unknown thrown values become an `unknown` failure, so the UI always has a code to translate. */
export const toApiFailure = (value: unknown): ApiFailure =>
  isApiFailure(value)
    ? value
    : apiFailure(0, 'unknown', value instanceof Error ? value.message : String(value))

const sessionLostCodes: ReadonlySet<FailureCode> = new Set([
  'auth/unauthenticated',
  'auth/session_expired',
  'auth/session_revoked',
  'auth/account_disabled',
])

/** The cookie session is gone: the app must go back to the login screen. */
export const isSessionLost = (failure: ApiFailure): boolean => sessionLostCodes.has(failure.code)

/**
 * The server refused the active profile itself (§14): its PIN unlock moved to the profile another
 * tab chose, it was deleted, or none is chosen. `/profiles*` answers `profile/pin_required` for the
 * profile it acts on, so only a refusal naming the active profile counts.
 */
export const isProfileLost = (failure: ApiFailure, activeProfileId: string | undefined): boolean =>
  failure.code === 'profile/required' ||
  ((failure.code === 'profile/pin_required' || failure.code === 'profile/forbidden') &&
    failure.context?.['profileId'] === activeProfileId)
