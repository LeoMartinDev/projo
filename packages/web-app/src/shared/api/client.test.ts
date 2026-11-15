import { expect, test } from 'bun:test'

import { bindFakeHost } from '../host/fake-host.ts'
import { setActiveProfileId } from '../session/active-profile.ts'
import { api, request, serverFetch } from './client.ts'

test('the API client goes through the host with root-relative paths and the profile header', async () => {
  const { requests } = bindFakeHost()
  setActiveProfileId('profile-1')
  await request(() => api.auth.me.$get())
  await request(() => api.admin.tmdb.search.$get({ query: { q: 'a b', kind: 'movie' } }))
  setActiveProfileId(undefined)
  expect(requests[0]?.path).toBe('/api/v1/auth/me')
  expect(requests[0]?.headers.get('x-profile-id')).toBe('profile-1')
  expect(requests[1]?.path).toBe('/api/v1/admin/tmdb/search?q=a+b&kind=movie')
})

test('raw requests go through the host as they are', async () => {
  const { requests } = bindFakeHost()
  await serverFetch('/health')
  expect(requests).toEqual([{ path: '/health', headers: new Headers(), method: 'GET' }])
})
