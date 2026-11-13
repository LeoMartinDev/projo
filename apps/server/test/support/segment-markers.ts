import { applySegmentsToSeasonFactory } from '../../src/application/segments/apply-segments-to-season.ts'
import { removeSegmentFactory } from '../../src/application/segments/remove-segment.ts'
import { setManualSegmentFactory } from '../../src/application/segments/set-manual-segment.ts'
import { segmentTargetFactory } from '../../src/application/segments/shared/segment-target.ts'
import type { PlayableSource, PlayableSources } from '../../src/core/catalog/catalog.ts'
import type { SegmentSettings } from '../../src/core/settings/settings.ts'
import { createManualClock } from './clock.ts'
import { createRecordingJobQueue } from './fakes.ts'
import { silentLogger } from './logger.ts'
import {
  type FactsInput,
  inMemorySegmentCatalog,
  inMemorySegments,
  inMemorySegmentSettings,
  readySource,
} from './segments.ts'

/** The admin marker use cases (§12.5) on a season of 3 episodes, a movie and a series. */

const minute = 60_000
const episode = (n: number): FactsInput => ({
  itemId: `e${n}`,
  kind: 'episode',
  seasonId: 's1',
  seasonNumber: 1,
  episodeNumber: n,
  tmdbId: 1,
  detectSegments: true,
})
const items: FactsInput[] = [
  episode(1),
  episode(2),
  episode(3),
  { itemId: 'm1', kind: 'movie', detectSegments: true },
  { itemId: 'show', kind: 'series', detectSegments: true },
]

export const createSegmentMarkersWorld = () => {
  const store = inMemorySegments()
  const jobs = createRecordingJobQueue()
  const sources: Record<string, PlayableSource[]> = {
    e1: [readySource('f1', 45 * minute)],
    e2: [readySource('f2', 45 * minute)],
    e3: [readySource('f3', 100_000)],
    m1: [readySource('f4', 120 * minute)],
  }

  const build = (settings: Partial<SegmentSettings> = {}) => {
    const clock = createManualClock(new Date('2026-10-24T12:00:00.000Z'))
    const segmentCatalog = inMemorySegmentCatalog(items)
    const playableSources: Pick<PlayableSources, 'listReadySources'> = {
      listReadySources: ({ itemId }) => sources[itemId] ?? [],
    }
    const deps = {
      segmentTarget: segmentTargetFactory({ segmentCatalog, playableSources }),
      segmentCatalog,
      segmentRepository: store.repository,
      settings: inMemorySegmentSettings(settings),
      jobQueue: jobs.queue,
      clock,
      logger: silentLogger,
    }
    return {
      setManualSegment: setManualSegmentFactory(deps),
      removeSegment: removeSegmentFactory(deps),
      applyToSeason: applySegmentsToSeasonFactory(deps),
    }
  }

  return { store, jobs, sources, build }
}

export type SegmentMarkersWorld = ReturnType<typeof createSegmentMarkersWorld>
