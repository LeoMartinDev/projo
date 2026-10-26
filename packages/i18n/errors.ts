import type { ErrorCode } from '@projo/shared/errors'

/**
 * Every API error code has a translation under `errors.<domain/reason>` (§19 "API error codes are
 * translated on the web"); `errors.network` (server unreachable) and `errors.unknown` (no
 * recognizable error body, thrown value) cover the rest. `errors.test.ts` checks that no code is
 * missing in any locale.
 */
export type TranslatedErrorCode = ErrorCode | 'network' | 'unknown'

export type ErrorKey = `errors.${TranslatedErrorCode}`

export const errorKeyOf = (code: TranslatedErrorCode): ErrorKey => `errors.${code}`
