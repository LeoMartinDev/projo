import { describe, expect, test } from 'bun:test'

import { createAuthTestApp, sessionCookieOf } from '../../../../test/support/auth-app.ts'

/** Editing, images and refresh (§9.3, §9.4, §17.2); behaviour in `test/integration/`. */
const editingRoutes: [string, string, unknown?][] = [
  ['GET', '/api/v1/admin/items/item-1'],
  ['PATCH', '/api/v1/admin/items/item-1', { title: 'Titre' }],
  ['DELETE', '/api/v1/admin/items/item-1/overrides/title'],
  ['POST', '/api/v1/admin/items/item-1/refresh'],
  ['GET', '/api/v1/admin/items/item-1/images/alternatives?kind=poster'],
  ['POST', '/api/v1/admin/items/item-1/images', { kind: 'poster', tmdbPath: '/a.jpg' }],
  ['POST', '/api/v1/admin/libraries/library-1/refresh-metadata'],
]

describe('admin items editing routes (§17.2)', () => {
  test('admins only: 401 without a session, 403 for a user', async () => {
    const t = createAuthTestApp()
    await t.completeSetup()
    await t.addUser()
    const zoe = t.as(sessionCookieOf(await t.login('zoe', 'another long password')))
    for (const [method, path, body] of editingRoutes) {
      const anonymous = await t.request(path, {
        method,
        headers: { origin: 'http://localhost', 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      expect([method, path, anonymous.status]).toEqual([method, path, 401])
      const forbidden = await zoe.send(method, path, body)
      expect([method, path, forbidden.status]).toEqual([method, path, 403])
    }
  })
})
