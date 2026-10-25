import type { ErrorCode } from './index.ts'

/** An expected failure. Plain object, never an `Error`. `message` is English, for logs. */
export type AppError<Code extends ErrorCode = ErrorCode> = {
  readonly code: Code
  readonly message: string
  readonly context?: Record<string, unknown>
  readonly cause?: unknown
}

export type AppErrorExtras = {
  context?: Record<string, unknown>
  cause?: unknown
}

export const appError = <Code extends ErrorCode>(
  code: Code,
  message: string,
  extras: AppErrorExtras = {},
): AppError<Code> => ({
  code,
  message,
  ...(extras.context === undefined ? {} : { context: extras.context }),
  ...(extras.cause === undefined ? {} : { cause: extras.cause }),
})

/** Wire format of an error in API responses: `{ error: ApiErrorBody }`. */
export type ApiErrorBody = {
  code: ErrorCode
  message: string
  context?: Record<string, unknown>
}

export type ApiErrorResponse = { error: ApiErrorBody }
