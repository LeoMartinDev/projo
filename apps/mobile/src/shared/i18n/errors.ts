import type { ConnectionErrorCode } from '../../features/server-connection/connection-error.ts'

/** Every error code has a translation under `errors.<code>` (checked by `locales.test.ts`). */
export type ErrorKey = `errors.${ConnectionErrorCode}`

export const errorKey = (code: ConnectionErrorCode): ErrorKey => `errors.${code}`
