import { type ErrorCode, isErrorCode } from '@projo/shared/errors'

export type ApiFailure = {
  readonly kind: 'api_failure'
  readonly status: number
  readonly code: FailureCode
  readonly message: string
  readonly context?: Record<string, unknown>
}

export type FailureCode = ErrorCode | 'network' | 'unknown'

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

export const isSessionLost = (failure: ApiFailure): boolean => sessionLostCodes.has(failure.code)

export const isProfileLost = (failure: ApiFailure, activeProfileId: string | undefined): boolean =>
  failure.code === 'profile/required' ||
  ((failure.code === 'profile/pin_required' || failure.code === 'profile/forbidden') &&
    failure.context?.['profileId'] === activeProfileId)
