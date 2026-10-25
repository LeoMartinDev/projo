import { expect, test } from 'bun:test'

import { createRecordingEventBus } from '../../test/support/fakes.ts'
import { startCatalogChanges } from './catalog-changes.ts'

const done = (type: string) => ({ jobId: 'j', type, state: 'done', attempts: 1 }) as const

test('one catalog.changed per burst of identifications, scans and ready files', async () => {
  const { bus, events } = createRecordingEventBus()
  const changes = startCatalogChanges({ eventBus: bus, windowMs: 20 })
  bus.publish('job.updated', done('match_source'))
  bus.publish('job.updated', done('fetch_images'))
  bus.publish('source.ready', { sourceId: 's', libraryId: 'l' })
  // Not a catalogue change: another job, or one not done.
  bus.publish('job.updated', done('index_keyframes'))
  await Bun.sleep(40)
  expect(events.filter((event) => event.type === 'catalog.changed')).toHaveLength(1)

  bus.publish('job.updated', { ...done('match_source'), state: 'running' })
  await Bun.sleep(40)
  expect(events.filter((event) => event.type === 'catalog.changed')).toHaveLength(1)

  bus.publish('job.updated', done('match_source'))
  changes.stop()
  await Bun.sleep(40)
  expect(events.filter((event) => event.type === 'catalog.changed')).toHaveLength(1)
})
