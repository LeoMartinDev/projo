import { describe, expect, test } from 'bun:test'

import {
  createSetupWorld as build,
  setupInput as input,
} from '../../../test/support/setup-world.ts'

describe('getSetupStatus', () => {
  test('creates the admin, its first profile and the settings', async () => {
    const t = build()
    expect(t.getSetupStatus()).toEqual({ completed: false })
    expect((await t.completeSetup(input)).ok).toBe(true)
    expect(t.getSetupStatus()).toEqual({ completed: true, serverName: 'Maison' })
  })
})
