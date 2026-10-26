import { type ErrorKey, errorKeyOf } from '@projo/i18n/errors'

import { type AppFailureCode, appFailureCodes, type FailureCode } from '../api/failure.ts'

const appCodes: ReadonlySet<string> = new Set(appFailureCodes)

const isAppCode = (code: FailureCode): code is AppFailureCode => appCodes.has(code)

/**
 * Translation key of a failure code: the server's codes under `errors.<code>` (`@projo/i18n`), the
 * app's own under `mobile.errors.<code>` (both checked for every locale by the tests).
 */
export const errorKey = (code: FailureCode): ErrorKey | `mobile.errors.${AppFailureCode}` =>
  isAppCode(code) ? `mobile.errors.${code}` : errorKeyOf(code)
