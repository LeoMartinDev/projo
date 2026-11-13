import { expect, test } from 'bun:test'

import { createOAuthWorld as setup, day, start } from '../../../test/support/oauth-world.ts'

test('the purge drops what expired and registrations unused for 30 days', () => {
  const world = setup()
  world.service.purge()
  expect(world.oauth.purged).toEqual([
    { now: start, unusedBefore: new Date(start.getTime() - 30 * day) },
  ])
})
