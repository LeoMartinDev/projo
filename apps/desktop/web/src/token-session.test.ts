import { expect, test } from 'bun:test'

import { err, ok, type Result } from '@projo/shared/result'

import type { CommandFailure } from './desktop-commands.ts'
import { tokenSession } from './token-session.ts'

const world = (failing = false) => {
  const calls: string[] = []
  const warnings: string[] = []
  const answer = (): Result<void, CommandFailure> =>
    failing ? err({ code: 'desktop/keyring_failed', message: 'locked' }) : ok()
  const { session, bearer } = tokenSession({
    token: 'saved',
    deviceName: 'Leo-PC',
    store: {
      setToken: async (token) => {
        calls.push(`set:${token}`)
        return answer()
      },
      clearToken: async () => {
        calls.push('clear')
        return answer()
      },
    },
    warn: (message) => warnings.push(message),
  })
  if (session.kind !== 'token') throw new Error('token session expected')
  return { session, bearer, calls, warnings }
}

test('starts with the token the app kept, named after the computer', () => {
  const { session, bearer } = world()
  expect(bearer()).toBe('saved')
  expect(session.deviceName).toBe('Leo-PC')
})

test('sign-in keeps the new token, sign-out forgets it, in memory and in the store', async () => {
  const { session, bearer, calls } = world()
  await session.keep('fresh')
  expect(bearer()).toBe('fresh')
  await session.drop()
  expect(bearer()).toBeUndefined()
  expect(calls).toEqual(['set:fresh', 'clear'])
})

test('a failing store leaves the session working for this run', async () => {
  const { session, bearer, warnings } = world(true)
  await session.keep('fresh')
  expect(bearer()).toBe('fresh')
  await session.drop()
  expect(bearer()).toBeUndefined()
  expect(warnings).toHaveLength(2)
})
