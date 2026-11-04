import { afterEach, expect, jest, test } from 'bun:test'

import { createEventHub, type EventSourceLike } from './events.ts'

type FakeSource = EventSourceLike & {
  closed: boolean
  emit: (type: string, data?: string) => void
}

const fakeSource = (): FakeSource => {
  const handlers = new Map<string, ((event: MessageEvent<string>) => void)[]>()
  const source: FakeSource = {
    readyState: 0,
    closed: false,
    addEventListener: (type, listener) =>
      handlers.set(type, [...(handlers.get(type) ?? []), listener]),
    close: () => {
      source.closed = true
    },
    emit: (type, data = '{}') => {
      for (const listener of handlers.get(type) ?? []) listener({ data } as MessageEvent<string>)
    },
  }
  return source
}

afterEach(() => {
  jest.useRealTimers()
})

test('reopens a stream the browser closed, re-wires its types and signals the catalog', () => {
  jest.useFakeTimers()
  const sources: FakeSource[] = []
  const hub = createEventHub(() => {
    const source = fakeSource()
    sources.push(source)
    return source
  })
  const ready: unknown[] = []
  const catalog: unknown[] = []
  hub.subscribe('source.ready', (payload) => ready.push(payload))
  hub.subscribe('catalog.changed', (payload) => catalog.push(payload))
  const [first] = sources
  if (first === undefined) throw new Error('no source opened')

  first.readyState = 2
  first.emit('error')
  expect(first.closed).toBe(true)
  jest.advanceTimersByTime(5000)
  expect(sources).toHaveLength(2)

  const second = sources[1]
  if (second === undefined) throw new Error('not reopened')
  second.emit('open')
  expect(catalog).toEqual([{}])
  second.emit('source.ready', JSON.stringify({ sourceId: 's', libraryId: 'l' }))
  expect(ready).toEqual([{ sourceId: 's', libraryId: 'l' }])
})

test('stops reopening once the last listener is gone', () => {
  jest.useFakeTimers()
  const sources: FakeSource[] = []
  const hub = createEventHub(() => {
    const source = fakeSource()
    sources.push(source)
    return source
  })
  const unsubscribe = hub.subscribe('catalog.changed', () => {})
  const [first] = sources
  if (first === undefined) throw new Error('no source opened')
  first.readyState = 2
  first.emit('error')
  unsubscribe()
  jest.advanceTimersByTime(60_000)
  expect(sources).toHaveLength(1)
})

test('signals a reconnection when the browser reopens the stream on its own, not on the first open', () => {
  const sources: FakeSource[] = []
  const hub = createEventHub(() => {
    const source = fakeSource()
    sources.push(source)
    return source
  })
  let reconnects = 0
  const catalog: unknown[] = []
  hub.onReconnect(() => {
    reconnects += 1
  })
  hub.subscribe('catalog.changed', (payload) => catalog.push(payload))
  const [source] = sources
  if (source === undefined) throw new Error('no source opened')

  source.emit('open')
  expect(reconnects).toBe(0)
  source.emit('error')
  source.emit('open')
  expect(reconnects).toBe(1)
  expect(catalog).toEqual([{}])
})

test('signals a reconnection when the first attempt failed before the stream opened', () => {
  const sources: FakeSource[] = []
  const hub = createEventHub(() => {
    const source = fakeSource()
    sources.push(source)
    return source
  })
  let reconnects = 0
  hub.onReconnect(() => {
    reconnects += 1
  })
  hub.subscribe('source.ready', () => {})
  const [source] = sources
  if (source === undefined) throw new Error('no source opened')
  source.emit('error')
  source.emit('open')
  expect(reconnects).toBe(1)
})

test('signals a reconnection when the hub reopened a closed stream', () => {
  jest.useFakeTimers()
  const sources: FakeSource[] = []
  const hub = createEventHub(() => {
    const source = fakeSource()
    sources.push(source)
    return source
  })
  let reconnects = 0
  hub.onReconnect(() => {
    reconnects += 1
  })
  hub.subscribe('source.ready', () => {})
  const [first] = sources
  if (first === undefined) throw new Error('no source opened')
  first.readyState = 2
  first.emit('error')
  jest.advanceTimersByTime(5000)
  sources[1]?.emit('open')
  expect(reconnects).toBe(1)
})
