import { beforeEach, describe, expect, test } from 'bun:test'

import type { CatalogRepository } from '../../core/catalog/catalog.ts'
import type { SegmentSettings } from '../../core/settings/settings.ts'
import { createManualClock } from '../../../test/support/clock.ts'
import { createCapturingLogger } from '../../../test/support/logger.ts'
import {
  fakeSegmentProviders,
  inMemorySegmentCatalog,
  inMemorySegments,
  inMemorySegmentSettings,
  inMemorySubmissions,
} from '../../../test/support/segments.ts'
import { submitSegmentFactory } from './submit-segment.ts'
import { segmentTargetFactory } from './targets.ts'

let store: ReturnType<typeof inMemorySegments>
let submissions: ReturnType<typeof inMemorySubmissions>

const build = (
  settings: Partial<SegmentSettings>,
  failing: Parameters<typeof fakeSegmentProviders>[1] = {},
) => {
  const fake = fakeSegmentProviders({}, failing)
  const { logger, lines } = createCapturingLogger()
  const submit = submitSegmentFactory({
    segmentTarget: segmentTargetFactory({
      segmentCatalog: inMemorySegmentCatalog([
        { itemId: 'm1', kind: 'movie', tmdbId: 603, detectSegments: true },
      ]),
      catalogRepository: { listReadySources: () => [] } as unknown as CatalogRepository,
    }),
    segmentRepository: store.repository,
    submissions: submissions.repository,
    contributors: fake.providers.contributors,
    settings: inMemorySegmentSettings(settings),
    clock: createManualClock(),
    logger,
  })
  return { submit: () => submit({ itemId: 'm1', type: 'intro' }), fake, lines }
}

const on = { contribution: 'manual_only', theintrodbApiKey: 'good-key' } as const

beforeEach(() => {
  store = inMemorySegments()
  submissions = inMemorySubmissions()
  store.repository.save({
    itemId: 'm1',
    origin: 'manual',
    candidate: { type: 'intro', startMs: 1_000, endMs: 60_000 },
  })
})

describe('submit_segment (§12.5)', () => {
  test('to TheIntroDB and SkipDB, logged, once per exact marker', async () => {
    const { submit, fake, lines } = build(on)
    expect(await submit()).toEqual({ ok: true, value: 'submitted' })
    expect(fake.submitted.map((entry) => entry.provider)).toEqual(['theintrodb', 'skipdb'])
    expect(submissions.rows.map((row) => [row.provider, row.outcome])).toEqual([
      ['theintrodb', 'submitted'],
      ['skipdb', 'submitted'],
    ])
    expect(lines.filter((line) => line.message === 'segment submitted')).toHaveLength(2)
    expect(await submit()).toEqual({ ok: true, value: 'skipped' })
    expect(fake.submitted).toHaveLength(2)
  })

  test('without TheIntroDB key: SkipDB only', async () => {
    const { submit, fake } = build({ contribution: 'manual_only' })
    await submit()
    expect(fake.submitted.map((entry) => entry.provider)).toEqual(['skipdb'])
  })

  test('contribution off, or no longer manual: nothing sent', async () => {
    const off = build({ contribution: 'off', theintrodbApiKey: 'good-key' })
    expect(await off.submit()).toEqual({ ok: true, value: 'skipped' })
    store.repository.remove({ itemId: 'm1', type: 'intro' })
    store.repository.save({
      itemId: 'm1',
      origin: 'chapter',
      candidate: { type: 'intro', startMs: 0, endMs: 5_000 },
    })
    const notManual = build(on)
    expect(await notManual.submit()).toEqual({ ok: true, value: 'skipped' })
    expect([...off.fake.submitted, ...notManual.fake.submitted]).toEqual([])
    expect(submissions.rows).toEqual([])
  })

  test('a provider out of reach: recorded as failed, the job fails to be retried', async () => {
    const { submit, fake } = build(on, { submitFails: { theintrodb: true } })
    expect(await submit()).toMatchObject({
      ok: false,
      error: { code: 'segment/provider_unavailable' },
    })
    expect(submissions.rows.map((row) => [row.provider, row.outcome])).toEqual([
      ['theintrodb', 'failed'],
      ['skipdb', 'submitted'],
    ])
    expect(fake.submitted.map((entry) => entry.provider)).toEqual(['skipdb'])
  })
})
