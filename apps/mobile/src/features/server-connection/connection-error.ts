/**
 * An expected failure while reaching the server, before any API call. Same shape as `AppError`
 * (`@projo/shared`), whose codes are the server's: these are the app's own. `message` is English,
 * for logs; the screen shows `errors.<code>`.
 */
export type ConnectionErrorCode =
  'connection/invalid_url' | 'connection/not_projo' | 'network' | 'unknown'

export type ConnectionError<Code extends ConnectionErrorCode = ConnectionErrorCode> = {
  readonly code: Code
  readonly message: string
  readonly context?: Record<string, unknown>
  readonly cause?: unknown
}

export const connectionError = <Code extends ConnectionErrorCode>(
  code: Code,
  message: string,
  extras: { context?: Record<string, unknown>; cause?: unknown } = {},
): ConnectionError<Code> => ({
  code,
  message,
  ...(extras.context === undefined ? {} : { context: extras.context }),
  ...(extras.cause === undefined ? {} : { cause: extras.cause }),
})

/** Any non-primitive (`Object(x) === x` excludes `null` without naming it, §5.3). */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && Object(value) === value

const codes: ReadonlySet<string> = new Set<ConnectionErrorCode>([
  'connection/invalid_url',
  'connection/not_projo',
  'network',
  'unknown',
])

/** Whatever a query or mutation failed with, as a `ConnectionError` (`unknown` if foreign). */
export const toConnectionError = (value: unknown): ConnectionError =>
  isRecord(value) && typeof value['code'] === 'string' && codes.has(value['code'])
    ? (value as ConnectionError)
    : connectionError('unknown', value instanceof Error ? value.message : String(value))
