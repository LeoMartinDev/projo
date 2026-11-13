import { describe, expect, test } from 'bun:test'

import { createRecordingEventBus } from '../../../test/support/fakes.ts'
import { createUpdateStateHolder } from './update-state-holder.ts'

describe('update state', () => {
  test('identical states are published once', () => {
    const { bus, events } = createRecordingEventBus()
    const state = createUpdateStateHolder({ eventBus: bus })
    state.set({ state: 'downloading', version: '1.4.0', progress: 10.2 })
    state.set({ state: 'downloading', version: '1.4.0', progress: 10.4 })
    state.set({ state: 'downloading', version: '1.4.0', progress: 11 })
    expect(events.map((event) => event.payload)).toEqual([
      { state: 'downloading', version: '1.4.0', progress: 10 },
      { state: 'downloading', version: '1.4.0', progress: 11 },
    ])
  })
})
