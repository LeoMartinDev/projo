import { describe, expect, test } from 'bun:test'

import type { ServerEvent } from '../../core/events.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import { createInMemoryEventBus } from './in-memory-event-bus.ts'

const finished = {
  jobId: 'j1',
  type: 'fetch_images',
  state: 'done',
  payload: { itemId: 'i1' },
} as const

describe('createInMemoryEventBus', () => {
  test('delivers client events to every stream subscriber until unsubscribed', () => {
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

  test('on: one type, client or internal, until unsubscribed', () => {
    const bus = createInMemoryEventBus({ logger: silentLogger })
    const ready: string[] = []
    const jobs: unknown[] = []
    const unsubscribe = bus.on('source.ready', ({ sourceId }) => ready.push(sourceId))
    bus.on('job.finished', (job) => jobs.push(job))

    bus.publish('source.ready', { sourceId: 's1', libraryId: 'l1' })
    bus.publish('update.state', { state: 'idle' })
    bus.publish('job.finished', finished)
    unsubscribe()
    bus.publish('source.ready', { sourceId: 's2', libraryId: 'l1' })

    expect(ready).toEqual(['s1'])
    expect(jobs).toEqual([finished])
  })

  test('internal events never reach the client stream', () => {
    const bus = createInMemoryEventBus({ logger: silentLogger })
    const received: string[] = []
    bus.subscribe((event) => received.push(event.type))

    bus.publish('job.finished', finished)
    bus.publish('update.state', { state: 'idle' })

    expect(received).toEqual(['update.state'])
  })

  test('delivers through afterCommit', () => {
    const deferred: (() => void)[] = []
    const bus = createInMemoryEventBus({
      logger: silentLogger,
      afterCommit: (effect) => deferred.push(effect),
    })
    const received: string[] = []
    bus.subscribe((event) => received.push(event.type))
    bus.on('job.finished', () => received.push('job.finished'))

    bus.publish('update.state', { state: 'idle' })
    bus.publish('job.finished', finished)
    expect(received).toEqual([])

    for (const effect of deferred) effect()
    expect(received).toEqual(['update.state', 'job.finished'])
  })

  test('isolates a throwing listener', () => {
    const bus = createInMemoryEventBus({ logger: silentLogger })
    const received: string[] = []
    bus.on('update.state', () => {
      throw new Error('listener bug')
    })
    bus.subscribe(() => {
      throw new Error('listener bug')
    })
    bus.subscribe((event) => received.push(event.type))

    expect(() => bus.publish('update.state', { state: 'idle' })).not.toThrow()
    expect(received).toEqual(['update.state'])
  })
})
