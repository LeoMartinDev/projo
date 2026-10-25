import { describe, expect, test } from 'bun:test'

import { createManualClock } from '../../../test/support/clock.ts'
import { createJsonLogger } from './json-logger.ts'

const capture = (level: 'debug' | 'info' | 'warn' | 'error' = 'debug') => {
  const lines: Record<string, unknown>[] = []
  const logger = createJsonLogger({
    level,
    clock: createManualClock(new Date('2026-10-23T10:00:00.000Z')),
    write: (line) => lines.push(JSON.parse(line) as Record<string, unknown>),
  })
  return { logger, lines }
}

describe('createJsonLogger', () => {
  test('writes one JSON object per line with level, time, msg and fields', () => {
    const { logger, lines } = capture()
    logger.info('job finished', { jobId: 'j1', code: 'job/handler_crashed' })
    expect(lines).toEqual([
      {
        level: 'info',
        time: '2026-10-23T10:00:00.000Z',
        msg: 'job finished',
        jobId: 'j1',
        code: 'job/handler_crashed',
      },
    ])
  })

  test('drops lines below the configured level', () => {
    const { logger, lines } = capture('warn')
    logger.debug('a')
    logger.info('b')
    logger.warn('c')
    logger.error('d')
    expect(lines.map((line) => line['msg'])).toEqual(['c', 'd'])
  })

  test('child loggers carry their bindings', () => {
    const { logger, lines } = capture()
    logger.child({ sessionId: 's1' }).child({ jobId: 'j1' }).warn('hello')
    expect(lines[0]).toMatchObject({ sessionId: 's1', jobId: 'j1', msg: 'hello' })
  })

  test('serializes errors and their causes', () => {
    const { logger, lines } = capture()
    logger.error('boom', { error: new Error('outer', { cause: new Error('inner') }) })
    expect(lines[0]?.['error']).toMatchObject({
      name: 'Error',
      message: 'outer',
      cause: { message: 'inner' },
    })
  })
})
