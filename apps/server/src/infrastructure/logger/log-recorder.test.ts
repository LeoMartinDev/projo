import { describe, expect, test } from 'bun:test'

import type { LogRecord } from '../../core/logs/log.ts'
import { createLogRecorder } from './log-recorder.ts'

const record = (message: string): LogRecord => ({
  time: new Date('2026-11-13T10:00:00.000Z'),
  level: 'info',
  message,
  fields: {},
})

const recordingStore = () => {
  const batches: string[][] = []
  return {
    batches,
    append: (records: readonly LogRecord[]) =>
      void batches.push(records.map((entry) => entry.message)),
  }
}

describe('log recorder', () => {
  test('holds the lines until a store is attached, then writes them in one batch', () => {
    const recorder = createLogRecorder({ flushEveryMs: 60_000 })
    recorder.record(record('a'))
    recorder.record(record('b'))
    const store = recordingStore()
    recorder.attach(store)
    expect(store.batches).toEqual([['a', 'b']])
    recorder.record(record('c'))
    expect(store.batches).toHaveLength(1)
    recorder.flush()
    expect(store.batches).toEqual([['a', 'b'], ['c']])
    recorder.detach()
  })

  test('keeps the newest lines when more arrive than it can hold, and says so', () => {
    const failures: string[] = []
    const recorder = createLogRecorder({
      capacity: 2,
      flushEveryMs: 60_000,
      reportFailure: (message) => void failures.push(message),
    })
    for (const message of ['a', 'b', 'c']) recorder.record(record(message))
    const store = recordingStore()
    recorder.attach(store)
    expect(store.batches).toEqual([['b', 'c']])
    expect(failures).toEqual(['log recorder dropped 1 lines before the store was ready'])
    recorder.detach()
  })

  test('a failing write loses its batch, reported outside the logger', () => {
    const failures: string[] = []
    const recorder = createLogRecorder({
      flushEveryMs: 60_000,
      reportFailure: (message) => void failures.push(message),
    })
    recorder.record(record('a'))
    recorder.attach({
      append: () => {
        throw new Error('disk full')
      },
    })
    expect(failures).toEqual(['log store write failed, 1 lines lost: Error: disk full'])
    recorder.detach()
  })

  test('detach flushes, then drops what comes after', () => {
    const recorder = createLogRecorder({ flushEveryMs: 60_000 })
    const store = recordingStore()
    recorder.attach(store)
    recorder.record(record('last'))
    recorder.detach()
    recorder.record(record('too late'))
    recorder.flush()
    expect(store.batches).toEqual([['last']])
  })
})
