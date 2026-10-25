import { describe, expect, test } from 'bun:test'

import { createBunPasswordHasher } from './bun-password-hasher.ts'
import { sessionTokens } from './session-tokens.ts'

describe('createBunPasswordHasher', () => {
  test('argon2id hash that verifies only the right password', async () => {
    const hasher = createBunPasswordHasher({ memoryCost: 1024, timeCost: 1 })
    const hash = await hasher.hash('correct horse battery')
    expect(hash).toStartWith('$argon2id$')
    expect(await hasher.verify('correct horse battery', hash)).toBe(true)
    expect(await hasher.verify('wrong', hash)).toBe(false)
    expect(await hasher.verify('x', 'not-a-hash')).toBe(false)
  })
})

describe('sessionTokens', () => {
  test('random 256-bit tokens, stable SHA-256 hex hash', () => {
    const a = sessionTokens.generate()
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(sessionTokens.generate()).not.toBe(a)
    expect(sessionTokens.hash(a)).toMatch(/^[0-9a-f]{64}$/)
    expect(sessionTokens.hash(a)).toBe(sessionTokens.hash(a))
  })
})
