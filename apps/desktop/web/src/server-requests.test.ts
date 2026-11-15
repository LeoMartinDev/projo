import { expect, test } from 'bun:test'

import { dispositionFilename, serverRequests, withBearer } from './server-requests.ts'

const recording = (answer: () => Response = () => Response.json({})) => {
  const sent: { url: string; init: RequestInit }[] = []
  let token: string | undefined = 'secret'
  const requests = serverRequests({
    serverOrigin: 'http://nas.local:8080',
    bearer: () => token,
    fetch: async (url, init) => {
      sent.push({ url, init })
      return answer()
    },
  })
  return {
    requests,
    sent,
    signOut: () => {
      token = undefined
    },
  }
}

const header = (init: RequestInit | undefined, name: string) =>
  new Headers(init?.headers).get(name) ?? undefined

test('API calls go to the server with the bearer, never a cookie', async () => {
  const { requests, sent } = recording()
  await requests.apiFetch('/api/v1/auth/me', { headers: { 'X-Profile-Id': 'p1' } })
  expect(sent[0]?.url).toBe('http://nas.local:8080/api/v1/auth/me')
  expect(header(sent[0]?.init, 'authorization')).toBe('Bearer secret')
  expect(header(sent[0]?.init, 'x-profile-id')).toBe('p1')
  expect(sent[0]?.init.credentials).toBe('omit')
})

test('without a token, no Authorization header', () => {
  expect(
    header(
      withBearer(() => undefined, { method: 'POST' }),
      'authorization',
    ),
  ).toBeUndefined()
})

test('the token is read at each request (signed out in between)', async () => {
  const { requests, sent, signOut } = recording()
  signOut()
  await requests.apiFetch('/health')
  expect(header(sent[0]?.init, 'authorization')).toBeUndefined()
})

test('events stream over fetch with the bearer', async () => {
  const { requests, sent } = recording()
  const controller = new AbortController()
  await requests.connectEvents(controller.signal)
  expect(sent[0]?.url).toBe('http://nas.local:8080/api/v1/events')
  expect(header(sent[0]?.init, 'authorization')).toBe('Bearer secret')
  expect(sent[0]?.init.signal).toBe(controller.signal)
})

test('the last heartbeat is a keepalive POST with the bearer', () => {
  const { requests, sent } = recording()
  requests.sendLeave('/api/v1/playback/sessions/s1/heartbeat', '{"positionMs":1}')
  expect(sent[0]?.url).toBe('http://nas.local:8080/api/v1/playback/sessions/s1/heartbeat')
  expect(sent[0]?.init).toMatchObject({
    method: 'POST',
    keepalive: true,
    body: '{"positionMs":1}',
  })
  expect(header(sent[0]?.init, 'authorization')).toBe('Bearer secret')
  expect(header(sent[0]?.init, 'content-type')).toBe('application/json')
})

test('a download takes the name the server gives it', async () => {
  const { requests } = recording(
    () =>
      new Response('{}', {
        headers: { 'content-disposition': 'attachment; filename="projo-logs-2026.ndjson"' },
      }),
  )
  const download = await requests.fetchDownload('/api/v1/admin/logs/export', 'projo-logs.ndjson')
  expect(download.ok && download.value.filename).toBe('projo-logs-2026.ndjson')
})

test('a refused download is an error', async () => {
  const { requests } = recording(() => new Response('', { status: 403 }))
  expect(await requests.fetchDownload('/api/v1/admin/db/export', 'projo.db')).toMatchObject({
    ok: false,
  })
})

test('Content-Disposition names, extended first', () => {
  expect(dispositionFilename(undefined, 'x.db')).toBe('x.db')
  expect(dispositionFilename('attachment', 'x.db')).toBe('x.db')
  expect(dispositionFilename('attachment; filename=projo.db', 'x.db')).toBe('projo.db')
  expect(
    dispositionFilename(
      `attachment; filename="logs.ndjson"; filename*=UTF-8''journ%C3%A9e.ndjson`,
      'x',
    ),
  ).toBe('journée.ndjson')
  expect(dispositionFilename(`attachment; filename*=utf-8''bad%E9.db`, 'x')).toBe('bad�.db')
})
