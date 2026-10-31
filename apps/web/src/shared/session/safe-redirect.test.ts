import { describe, expect, test } from 'bun:test'

import { safeRedirect } from './safe-redirect.ts'

describe('safeRedirect', () => {
  test('same-app paths only', () => {
    expect(safeRedirect('/series/1?tab=2')).toBe('/series/1?tab=2')
    expect(safeRedirect(undefined)).toBe('/')
    expect(safeRedirect('https://evil.example')).toBe('/')
    expect(safeRedirect('//evil.example')).toBe('/')
  })
})
