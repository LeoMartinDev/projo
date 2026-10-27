import { describe, expect, spyOn, test } from 'bun:test'

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

  test('runs one hash or verify at a time, and a failure frees the slot', async () => {
    let active = 0
    let peak = 0
    const slow = async (plain: string) => {
      active += 1
      peak = Math.max(peak, active)
      await Bun.sleep(5)
      active -= 1
      if (plain === 'boom') throw new Error('boom')
      return true
    }
    const hash = spyOn(Bun.password, 'hash').mockImplementation(
      async (p) => `${await slow(String(p))}`,
    )
    const verify = spyOn(Bun.password, 'verify').mockImplementation((p) => slow(String(p)))
    try {
      const hasher = createBunPasswordHasher()
      const results = await Promise.allSettled([
        hasher.hash('boom'),
        hasher.verify('boom', 'h'),
        ...Array.from({ length: 4 }, () => hasher.hash('a')),
        ...Array.from({ length: 4 }, () => hasher.verify('a', 'h')),
      ])
      expect(peak).toBe(1)
      expect(results.map((r) => r.status)).toEqual(['rejected', ...Array(9).fill('fulfilled')])
    } finally {
      hash.mockRestore()
      verify.mockRestore()
    }
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
