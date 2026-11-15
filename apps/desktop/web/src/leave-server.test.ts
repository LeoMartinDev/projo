import { expect, test } from 'bun:test'

import { err, ok } from '@projo/shared/result'

import { leaveServerFactory } from './leave-server.ts'

const world = ({
  signedOut = false,
  server = () => Promise.resolve(new Response(undefined, { status: 204 })),
}: { signedOut?: boolean; server?: () => Promise<Response> } = {}) => {
  const calls: string[] = []
  const leave = leaveServerFactory({
    commands: {
      getServer: async () => ok('http://nas:8080'),
      getToken: async () => ok(signedOut ? undefined : 'secret'),
      changeServer: async () => {
        calls.push('change_server')
        return ok()
      },
    },
    fetch: async (url, init) => {
      calls.push(`${init.method} ${url} ${new Headers(init.headers).get('authorization')}`)
      return server()
    },
    timeoutMs: 50,
  })
  return { leave, calls }
}

test('signs out on the server with the bearer, then changes server', async () => {
  const { leave, calls } = world()
  await leave()
  expect(calls).toEqual(['POST http://nas:8080/api/v1/auth/logout Bearer secret', 'change_server'])
})

test('without a token, changes server at once', async () => {
  const { leave, calls } = world({ signedOut: true })
  await leave()
  expect(calls).toEqual(['change_server'])
})

test('an unreachable server does not hold the change', async () => {
  const { leave, calls } = world({ server: () => Promise.reject(new TypeError('Failed to fetch')) })
  await leave()
  expect(calls.at(-1)).toBe('change_server')
})

test('one change at a time', async () => {
  const { leave, calls } = world()
  await Promise.all([leave(), leave()])
  expect(calls.filter((call) => call === 'change_server')).toHaveLength(1)
})

test('a refused change can be asked again', async () => {
  let refusals = 1
  const calls: string[] = []
  const leave = leaveServerFactory({
    commands: {
      getServer: async () => ok(undefined),
      getToken: async () => ok(undefined),
      changeServer: async () => {
        calls.push('change_server')
        return refusals-- > 0 ? err({ code: 'desktop/internal', message: 'x' }) : ok()
      },
    },
    fetch: async () => new Response(),
  })
  await leave()
  await leave()
  expect(calls).toEqual(['change_server', 'change_server'])
})
