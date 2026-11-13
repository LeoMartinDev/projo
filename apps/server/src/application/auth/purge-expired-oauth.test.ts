import { expect, test } from 'bun:test'

import { createOAuthWorld as setup, dayMs, oauthStart } from '../../../test/support/oauth-world.ts'

test('the purge drops what expired and registrations unused for 30 days', () => {
  const world = setup()
  world.purgeExpiredOAuth()
  expect(world.oauth.purged).toEqual([
    { now: oauthStart, unusedBefore: new Date(oauthStart.getTime() - 30 * dayMs) },
  ])
})
