import { describe, expect, test } from 'bun:test'
import { errorMessage, messagesFor, pickLocale } from './messages.ts'

describe('desktop setup messages', () => {
  test('follows the system language, English by default', () => {
    expect(pickLocale(['fr-FR', 'en-US'])).toBe('fr')
    expect(pickLocale(['FR'])).toBe('fr')
    expect(pickLocale(['en-GB', 'fr-FR'])).toBe('en')
    expect(pickLocale(['de-DE'])).toBe('en')
    expect(pickLocale([])).toBe('en')
  })

  test('translates command errors by code', () => {
    const fr = messagesFor('fr')
    expect(errorMessage(fr, { code: 'server/unreachable', message: 'timeout' })).toBe(
      fr.errors['server/unreachable'],
    )
    expect(errorMessage(fr, { code: 'something/else' })).toBe(fr.errors.unknown)
    expect(errorMessage(fr, 'plain string')).toBe(fr.errors.unknown)
    expect(errorMessage(fr, undefined)).toBe(fr.errors.unknown)
  })

  test('has the same keys in both languages', () => {
    expect(Object.keys(messagesFor('fr').errors).sort()).toEqual(
      Object.keys(messagesFor('en').errors).sort(),
    )
  })
})
