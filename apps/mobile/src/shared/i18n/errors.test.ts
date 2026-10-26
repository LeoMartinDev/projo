import { describe, expect, test } from 'bun:test'

import en from '@projo/i18n/en.json'
import fr from '@projo/i18n/fr.json'

import { appFailureCodes } from '../api/failure.ts'
import { errorKey } from './errors.ts'

describe('errorKey', () => {
  test('the server codes are the shared ones, the app codes its own', () => {
    expect(errorKey('auth/pairing_expired')).toBe('errors.auth/pairing_expired')
    expect(errorKey('network')).toBe('errors.network')
    expect(errorKey('connection/not_projo')).toBe('mobile.errors.connection/not_projo')
  })

  for (const [locale, messages] of Object.entries({ fr, en })) {
    test(`every app failure code has a ${locale} message, and only those`, () => {
      const table: Record<string, string | undefined> = messages.mobile.errors
      expect(appFailureCodes.filter((code) => (table[code] ?? '').trim() === '')).toEqual([])
      const known = new Set<string>(appFailureCodes)
      expect(Object.keys(table).filter((code) => !known.has(code))).toEqual([])
    })
  }
})
