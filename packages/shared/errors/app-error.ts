import type { ErrorCode } from './index.ts'

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

export type ApiErrorBody = {
  code: ErrorCode
  message: string
  context?: Record<string, unknown>
}

export type ApiErrorResponse = { error: ApiErrorBody }
