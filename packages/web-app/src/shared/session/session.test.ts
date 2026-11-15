import { expect, test } from 'bun:test'

import type { MeResponse } from '@projo/shared/api/auth'

import { mediaUrl, setMediaKey } from '../api/media.ts'
import { bindFakeHost, recordingTokenSession } from '../host/fake-host.ts'
import { claimPairing, completeSignIn, sessionQuery, signInOptions } from './session.ts'

const me: MeResponse = {
  account: { id: 'a1', username: 'leo', role: 'admin' },
  profiles: [],
  needsProfileSelection: false,
}

const fetchSession = () => sessionQuery.queryFn?.({} as never)

test('sign-in asks for a token, with the device name, on a token host only', () => {
  expect(signInOptions({ kind: 'cookie' })).toEqual({})
  expect(signInOptions(recordingTokenSession().session)).toEqual({
    token: true,
    deviceName: 'projo desktop · Windows',
  })
})

test('a cookie sign-in is complete as the server answered it', async () => {
  bindFakeHost()
  expect(await completeSignIn({ kind: 'cookie' }, me)).toEqual(me)
})

test('a token sign-in keeps the token, then reads /auth/me over it for the media key', async () => {
  const { session, calls } = recordingTokenSession()
  const { requests } = bindFakeHost({
    session,
    server: () => Response.json({ ...me, mediaKey: 's1.mac' }),
  })
  expect(await completeSignIn(session, { ...me, token: 'secret' })).toEqual({
    ...me,
    mediaKey: 's1.mac',
  })
  expect(calls).toEqual(['keep:secret'])
  expect(requests.map((request) => request.path)).toEqual(['/api/v1/auth/me'])
})

test('a token sign-in whose /auth/me fails leaves no token behind', async () => {
  const { session, calls } = recordingTokenSession()
  bindFakeHost({ session, server: () => new Response('', { status: 500 }) })
  await expect(completeSignIn(session, { ...me, token: 'secret' })).rejects.toMatchObject({
    status: 500,
  })
  expect(calls).toEqual(['keep:secret', 'drop'])
})

test('a 401 on /auth/me drops the token and the media key: signed out', async () => {
  const { session, calls } = recordingTokenSession()
  bindFakeHost({ session, server: () => new Response('', { status: 401 }) })
  setMediaKey('s1.mac')
  expect(await fetchSession()).toEqual({ status: 'anonymous' })
  expect(calls).toEqual(['drop'])
  expect(mediaUrl('/api/v1/images/a')).toBe('http://nas.local:8080/api/v1/images/a')
})

test('a pairing code is claimed with the device name, then held like a sign-in', async () => {
  const { session, calls } = recordingTokenSession()
  if (session.kind !== 'token') throw new Error('token session expected')
  const { requests } = bindFakeHost({
    session,
    server: (path) =>
      path === '/api/v1/auth/pairings/claim'
        ? Response.json({ token: 'paired' })
        : Response.json({ ...me, mediaKey: 's2.mac' }),
  })
  expect(await claimPairing(session, 'ABC234')).toEqual({ ...me, mediaKey: 's2.mac' })
  expect(calls).toEqual(['keep:paired'])
  expect(requests.map(({ path, method }) => `${method} ${path}`)).toEqual([
    'POST /api/v1/auth/pairings/claim',
    'GET /api/v1/auth/me',
  ])
})

test('a refused pairing code keeps nothing', async () => {
  const { session, calls } = recordingTokenSession()
  if (session.kind !== 'token') throw new Error('token session expected')
  bindFakeHost({
    session,
    server: () => Response.json({ error: { code: 'auth/pairing_invalid' } }, { status: 400 }),
  })
  await expect(claimPairing(session, 'ZZZZZZ')).rejects.toMatchObject({ status: 400 })
  expect(calls).toEqual([])
})
