import { describe, expect, test } from 'bun:test'

import { errorCodes } from '@projo/shared'

import { errorStatusByCode, statusForError } from './error-mapping.ts'

describe('error mapping', () => {
  test('maps every declared error code, and nothing else', () => {
    expect(Object.keys(errorStatusByCode).sort()).toEqual([...errorCodes].sort())
  })

  test('error codes are unique and follow domain/reason', () => {
    expect(new Set(errorCodes).size).toBe(errorCodes.length)
    for (const code of errorCodes) expect(code).toMatch(/^[a-z]+\/[a-z_]+$/)
  })

  test('returns the mapped status, or 500 for an unknown code', () => {
    expect(statusForError('library/not_found')).toBe(404)
    expect(statusForError('auth/unauthenticated')).toBe(401)
    expect(statusForError('nope/unknown')).toBe(500)
  })
})
