import { describe, expect, test } from 'bun:test'

import type { ServerEvent } from '../../core/events.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import { createInMemoryEventBus } from './in-memory-event-bus.ts'

describe('createInMemoryEventBus', () => {
  test('delivers typed events to every subscriber until unsubscribed', () => {
    const bus = createInMemoryEventBus({ logger: silentLogger })
    const received: ServerEvent[] = []
    const unsubscribe = bus.subscribe((event) => received.push(event))

    bus.publish('source.ready', { sourceId: 's1', libraryId: 'l1' })
    unsubscribe()
    bus.publish('source.ready', { sourceId: 's2', libraryId: 'l1' })

    expect(received).toEqual([
      { type: 'source.ready', payload: { sourceId: 's1', libraryId: 'l1' } },
    ])
  })

  test('isolates a throwing listener', () => {
    const bus = createInMemoryEventBus({ logger: silentLogger })
    const received: string[] = []
    bus.subscribe(() => {
      throw new Error('listener bug')
    })
    bus.subscribe((event) => received.push(event.type))

    expect(() => bus.publish('update.state', { state: 'idle' })).not.toThrow()
    expect(received).toEqual(['update.state'])
  })
})
