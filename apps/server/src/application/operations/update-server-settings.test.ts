import { describe, expect, test } from 'bun:test'

import { createManualClock } from '../../../test/support/clock.ts'
import { t0 } from '../../../test/support/operations-fakes.ts'
import { updateServerSettingsFactory } from './update-server-settings.ts'

describe('settings "Lecture" and "Serveur" (§15)', () => {
  test('server: the name is stored, the rest comes from the environment', () => {
    let name = 'projo'
    const update = updateServerSettingsFactory({
      store: { read: () => name, write: (input) => (name = input.name) },
      environment: { port: 8080, trustProxy: true, dataDir: '/data' },
      clock: createManualClock(t0),
    })
    expect(update({ name: 'Maison' })).toEqual({
      name: 'Maison',
      port: 8080,
      trustProxy: true,
      dataDir: '/data',
    })
  })
})
