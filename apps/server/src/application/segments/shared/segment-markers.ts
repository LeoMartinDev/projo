import type { Clock } from '../../../core/clock.ts'
import type { JobQueue } from '../../../core/jobs/ports.ts'
import {
  noSegmentKey,
  type SegmentRepository,
  type SegmentType,
} from '../../../core/segments/segment.ts'
import type { SegmentSettingsReader } from '../../../core/settings/settings.ts'
import { requestSubmission } from './segment-requests.ts'
import { segmentsView } from './segments-view.ts'

/** The segments of an item as the admin editor shows them, chain lookups included. */
export const markersView =
  (segmentRepository: Pick<SegmentRepository, 'listByItem' | 'listLookups'>) =>
  (itemId: string, durationMs: number | undefined) =>
    segmentsView(segmentRepository, {
      itemId,
      ...(durationMs === undefined ? {} : { durationMs }),
      withLookups: true,
    })

/** Negative marker: no segment of this type, set by the admin only. */
export const markAbsentFactory =
  ({ segmentRepository, clock }: { segmentRepository: SegmentRepository; clock: Clock }) =>
  (itemId: string, type: SegmentType) => {
    segmentRepository.remove({ itemId, type })
    segmentRepository.saveLookup({
      itemId,
      provider: noSegmentKey(type),
      checkedAt: clock.now(),
      outcome: 'no_segment',
    })
  }

/** Manual marker, contributed to TheIntroDB when the settings say so. */
export const markManualFactory = ({
  segmentRepository,
  settings,
  jobQueue,
}: {
  segmentRepository: SegmentRepository
  settings: SegmentSettingsReader
  jobQueue: JobQueue
}) => {
  const contribute = (itemId: string, type: SegmentType) => {
    if (settings.read().contribution === 'manual_only') requestSubmission(jobQueue, itemId, type)
  }
  return (itemId: string, type: SegmentType, startMs: number, endMs: number) => {
    segmentRepository.removeLookup({ itemId, provider: noSegmentKey(type) })
    segmentRepository.save({ itemId, origin: 'manual', candidate: { type, startMs, endMs } })
    contribute(itemId, type)
  }
}
