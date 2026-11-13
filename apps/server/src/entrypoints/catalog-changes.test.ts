import { expect, test } from 'bun:test'

import type { JobType } from '../core/jobs/job.ts'
import { createRecordingEventBus } from '../../test/support/fakes.ts'
import { startCatalogChanges } from './catalog-changes.ts'

const finished = (type: JobType, state: 'done' | 'failed' = 'done') =>
  ({ jobId: 'j', type, state, payload: {} }) as const

test('one catalog.changed per burst of identifications, scans and ready files', async () => {
  const { bus, events } = createRecordingEventBus()
  const changes = startCatalogChanges({ eventBus: bus, windowMs: 20 })
  bus.publish('job.finished', finished('match_source'))
  bus.publish('job.finished', finished('fetch_images'))
  bus.publish('source.ready', { sourceId: 's', libraryId: 'l' })
  bus.publish('job.finished', finished('index_keyframes'))
  await Bun.sleep(40)
  expect(events.filter((event) => event.type === 'catalog.changed')).toHaveLength(1)

  bus.publish('job.finished', finished('match_source', 'failed'))
  bus.publish('job.finished', finished('index_keyframes'))
  bus.publish('job.updated', { jobId: 'j', type: 'match_source', state: 'done', attempts: 1 })
  await Bun.sleep(40)
  expect(events.filter((event) => event.type === 'catalog.changed')).toHaveLength(1)

  bus.publish('scan.finished', {
    libraryId: 'l',
    scanRunId: 'r',
    stats: { discovered: 0, pending: 0, ready: 0, missing: 0, errors: 0, seen: 0, moved: 0 },
  })
  await Bun.sleep(40)
  expect(events.filter((event) => event.type === 'catalog.changed')).toHaveLength(2)

  bus.publish('job.finished', finished('match_source'))
  changes.stop()
  await Bun.sleep(40)
  expect(events.filter((event) => event.type === 'catalog.changed')).toHaveLength(2)
})
