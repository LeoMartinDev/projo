import { type ErrorKey, errorKeyOf } from '@projo/i18n/errors'

import { type AppFailureCode, appFailureCodes, type FailureCode } from '../api/failure.ts'

const appCodes: ReadonlySet<string> = new Set(appFailureCodes)

const isAppCode = (code: FailureCode): code is AppFailureCode => appCodes.has(code)

export const errorKey = (code: FailureCode): ErrorKey | `mobile.errors.${AppFailureCode}` =>
  isAppCode(code) ? `mobile.errors.${code}` : errorKeyOf(code)
