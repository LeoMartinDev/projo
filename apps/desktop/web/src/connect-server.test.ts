import { expect, test } from 'bun:test'

import { err, ok, type Result } from '@projo/shared/result'

import { type ConnectError, connectServerFactory, fetchSetupStatus } from './connect-server.ts'
import type { CommandFailure, ServerCheck } from './desktop-commands.ts'

const world = ({
  check = async (url: string): Promise<Result<ServerCheck, CommandFailure>> =>
    ok({ serverUrl: url, version: '1.25.0' }),
  completed = true,
}: {
  check?: (url: string) => Promise<Result<ServerCheck, CommandFailure>>
  completed?: boolean | ConnectError
} = {}) => {
  const saved: string[] = []
  const connect = connectServerFactory({
    commands: {
      checkServer: check,
      saveServer: async (url) => {
        saved.push(url)
        return ok(url)
      },
    },
    setupStatus: async () =>
      typeof completed === 'boolean' ? ok({ completed, serverName: 'Maison' }) : err(completed),
    minimumServerVersion: '1.25.0',
  })
  return { connect, saved }
}

test('a set-up server recent enough is ready with its setup status, and saved', async () => {
  const { connect, saved } = world({
    check: async () => ok({ serverUrl: 'http://nas.local:8080', version: '1.26.1' }),
  })
  expect(await connect('nas.local:8080/admin')).toEqual(
    ok({
      kind: 'ready',
      serverUrl: 'http://nas.local:8080',
      setupStatus: { completed: true, serverName: 'Maison' },
    }),
  )
  expect(saved).toEqual(['http://nas.local:8080'])
})

test('a server too old is refused without asking it more, and not saved', async () => {
  const { connect, saved } = world({
    check: async (url) => ok({ serverUrl: url, version: '1.24.0' }),
    completed: { code: 'server/unreachable', message: 'no CORS on an old server' },
  })
  expect(await connect('http://nas:8080')).toEqual(
    ok({ kind: 'outdated', serverUrl: 'http://nas:8080', version: '1.24.0' }),
  )
  expect(saved).toEqual([])
})

test('a server not set up yet sends its setup to the browser, and is not saved', async () => {
  const { connect, saved } = world({ completed: false })
  expect(await connect('http://nas:8080')).toEqual(
    ok({ kind: 'not_set_up', serverUrl: 'http://nas:8080' }),
  )
  expect(saved).toEqual([])
})

test('an address that does not answer like projo is not saved', async () => {
  const refusal = { code: 'server/not_projo', message: '/health did not answer' }
  const { connect, saved } = world({ check: async () => err(refusal) })
  expect(await connect('http://router.local')).toEqual(err(refusal))
  expect(saved).toEqual([])
})

test('a setup status that cannot be read is unreachable, and not saved', async () => {
  const { connect, saved } = world({
    completed: { code: 'server/unreachable', message: 'failed' },
  })
  expect(await connect('http://nas:8080')).toMatchObject({
    ok: false,
    error: { code: 'server/unreachable' },
  })
  expect(saved).toEqual([])
})

test('the setup status is read from the server over fetch', async () => {
  const asked: string[] = []
  const status = fetchSetupStatus(async (url) => {
    asked.push(url)
    return Response.json({ completed: false })
  })
  expect(await status('http://nas:8080')).toEqual(ok({ completed: false }))
  expect(asked).toEqual(['http://nas:8080/api/v1/setup/status'])
})

test('a failed or odd setup status is unreachable', async () => {
  const failing = fetchSetupStatus(async () => {
    throw new TypeError('Failed to fetch')
  })
  expect(await failing('http://nas:8080')).toMatchObject({
    ok: false,
    error: { code: 'server/unreachable' },
  })
  const odd = fetchSetupStatus(async () => Response.json({ hello: true }))
  expect(await odd('http://nas:8080')).toMatchObject({
    ok: false,
    error: { code: 'server/unreachable' },
  })
})

test('a server that never answers is unreachable in time, its request aborted', async () => {
  const aborted: string[] = []
  const silent = fetchSetupStatus(
    (_url, signal) =>
      new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborted.push('aborted')
          reject(new Error('aborted'))
        })
      }),
    { timeoutMs: 20 },
  )
  expect(await silent('http://nas:8080')).toMatchObject({
    ok: false,
    error: { code: 'server/unreachable' },
  })
  expect(aborted).toEqual(['aborted'])
})

test('a body that never ends, or a fetch deaf to the signal, is given up in time', async () => {
  const endless = fetchSetupStatus(
    async () => new Response(new ReadableStream({ start: () => undefined })),
    { timeoutMs: 20 },
  )
  expect(await endless('http://nas:8080')).toMatchObject({
    ok: false,
    error: { code: 'server/unreachable' },
  })
  const deaf = fetchSetupStatus(() => new Promise<Response>(() => undefined), { timeoutMs: 20 })
  expect(await deaf('http://nas:8080')).toMatchObject({
    ok: false,
    error: { code: 'server/unreachable' },
  })
})
