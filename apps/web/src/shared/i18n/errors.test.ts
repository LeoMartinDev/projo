import { describe, expect, test } from 'bun:test'

import { genreIds } from '@projo/shared/api/genres'
import { rootErrorReasons } from '@projo/shared/api/libraries'
import { notificationKinds } from '@projo/shared/api/notifications'
import { editionIds } from '@projo/shared/api/versions'
import { errorCodes } from '@projo/shared/errors'

import { apiFailure, failureFromBody } from '../api/failure.ts'
import en from './en.json'
import { errorKey } from './errors.ts'
import fr from './fr.json'

const locales = { fr, en } as const

/** Flattens `{ a: { b: 'x' } }` into `['a.b']`. Error keys keep their `/`. */
const keysOf = (value: unknown, prefix = ''): string[] =>
  typeof value === 'object' && Object(value) === value
    ? Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
        keysOf(child, prefix === '' ? key : `${prefix}.${key}`),
      )
    : [prefix]

describe('error translations', () => {
  for (const [locale, messages] of Object.entries(locales)) {
    test(`every API error code has a ${locale} message`, () => {
      const table = messages.errors as Record<string, string | undefined>
      const missing = errorCodes.filter((code) => (table[code] ?? '').trim().length === 0)
      expect(missing).toEqual([])
    })

    test(`${locale} has no translation for a code that does not exist`, () => {
      const known = new Set<string>([...errorCodes, 'network', 'unknown'])
      const extra = Object.keys(messages.errors).filter((code) => !known.has(code))
      expect(extra).toEqual([])
    })
  }

  for (const [locale, messages] of Object.entries(locales)) {
    test(`every notification kind has a ${locale} title`, () => {
      const titles = messages.admin.notifications as Record<string, string | undefined>
      const missing = notificationKinds.filter((kind) => (titles[kind] ?? '').trim().length === 0)
      expect(missing).toEqual([])
    })
  }

  for (const [locale, messages] of Object.entries(locales)) {
    test(`every genre id has a ${locale} label, and only those (§9.1)`, () => {
      const labels = messages.genres as Record<string, string | undefined>
      expect(genreIds.filter((id) => (labels[id] ?? '').trim().length === 0)).toEqual([])
      const known = new Set<string>(genreIds)
      expect(Object.keys(labels).filter((id) => !known.has(id))).toEqual([])
    })

    test(`every root error reason has a ${locale} label, and only those (§7.5)`, () => {
      const labels = messages.admin.rootError as Record<string, string | undefined>
      expect(rootErrorReasons.filter((id) => (labels[id] ?? '').trim().length === 0)).toEqual([])
      const known = new Set<string>(rootErrorReasons)
      expect(Object.keys(labels).filter((id) => !known.has(id))).toEqual([])
    })

    test(`every edition id has a ${locale} label, and only those (§8.1)`, () => {
      const labels = messages.editions as Record<string, string | undefined>
      expect(editionIds.filter((id) => (labels[id] ?? '').trim().length === 0)).toEqual([])
      const known = new Set<string>(editionIds)
      expect(Object.keys(labels).filter((id) => !known.has(id))).toEqual([])
    })
  }

  test('fr and en have exactly the same keys', () => {
    expect(keysOf(en).toSorted()).toEqual(keysOf(fr).toSorted())
  })

  test('no empty string in any locale', () => {
    for (const messages of Object.values(locales)) {
      const empty = keysOf(messages).filter((key) => {
        const value = key
          .split('.')
          .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], messages)
        return typeof value !== 'string' || value.trim().length === 0
      })
      expect(empty).toEqual([])
    }
  })
})

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
