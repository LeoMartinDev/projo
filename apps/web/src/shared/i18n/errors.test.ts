import { describe, expect, test } from 'bun:test'

import { apiFailure, failureFromBody } from '../api/failure.ts'
import { errorKey } from './errors.ts'

describe('errorKey', () => {
  test('maps an API failure to its translation key', () => {
    expect(errorKey(apiFailure(401, 'auth/invalid_credentials', 'nope'))).toBe(
      'errors.auth/invalid_credentials',
    )
  })

  test('unknown codes from the server and thrown values fall back to `unknown`', () => {
    expect(errorKey(failureFromBody(500, { error: { code: 'nope/what', message: 'x' } }))).toBe(
      'errors.unknown',
    )
    expect(errorKey(new Error('boom'))).toBe('errors.unknown')
    expect(errorKey(failureFromBody(502, 'Bad gateway'))).toBe('errors.unknown')
  })

  test('reads the error body of the API', () => {
    expect(
      failureFromBody(409, {
        error: { code: 'library/name_taken', message: 'taken', context: { name: 'Films' } },
      }),
    ).toEqual({
      kind: 'api_failure',
      status: 409,
      code: 'library/name_taken',
      message: 'taken',
      context: { name: 'Films' },
    })
  })
})
