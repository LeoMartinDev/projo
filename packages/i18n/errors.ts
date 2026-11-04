import type { ErrorCode } from '@projo/shared/errors'

export type TranslatedErrorCode = ErrorCode | 'network' | 'unknown'

export type ErrorKey = `errors.${TranslatedErrorCode}`

export const errorKeyOf = (code: TranslatedErrorCode): ErrorKey => `errors.${code}`
