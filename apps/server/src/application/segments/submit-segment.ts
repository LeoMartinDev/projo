import { type AppError, err, ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type {
  SegmentContributor,
  SegmentRepository,
  SegmentSubmissionRepository,
  SegmentType,
} from '../../core/segments/segment.ts'
import type { SegmentSettingsReader } from '../../core/settings/settings.ts'
import type { SegmentTargetOf } from './targets.ts'

type Deps = {
  segmentTarget: SegmentTargetOf
  segmentRepository: Pick<SegmentRepository, 'find'>
  submissions: SegmentSubmissionRepository
  contributors: Record<SegmentContributor['id'], SegmentContributor>
  settings: SegmentSettingsReader
  clock: Clock
  logger: Logger
}

export type SubmitSegmentOutcome = 'skipped' | 'submitted'

/**
 * Job `submit_segment` (§12.5, by item and type): a manual marker sent to TheIntroDB (only with
 * the admin key) and SkipDB (anonymous key created on first use), each provider once per exact
 * marker. Never a chapter or fingerprint segment: the marker must still be manual when the job
 * runs. Every attempt is logged in `segment_submissions`. A provider out of reach fails the job
 * (retried with backoff, §18); a refused marker does not.
 */
export const submitSegmentFactory =
  ({
    segmentTarget,
    segmentRepository,
    submissions,
    contributors,
    settings,
    clock,
    logger,
  }: Deps) =>
  async ({
    itemId,
    type,
  }: {
    itemId: string
    type: SegmentType
  }): Promise<Result<SubmitSegmentOutcome, AppError<'segment/provider_unavailable'>>> => {
    const config = settings.read()
    if (config.contribution !== 'manual_only') return ok('skipped')
    const segment = segmentRepository.find({ itemId, type })
    if (segment === undefined || segment.origin !== 'manual') return ok('skipped')
    const target = segmentTarget(itemId)
    // A file holding several episodes (§8.4): the marker is on the file's timeline, not the
    // episode's, so the databases would get E02's intro minutes in (same rule as fetch_segments).
    if (!target.ok || target.value.sharesFile) return ok('skipped')
    const { startMs, endMs } = segment
    const log = logger.child({ itemId, type })

    const targets: SegmentContributor[] = [
      ...(config.theintrodbApiKey === undefined ? [] : [contributors.theintrodb]),
      contributors.skipdb,
    ]
    let unavailable: AppError<'segment/provider_unavailable'> | undefined
    let submitted = 0
    for (const contributor of targets) {
      const key = { itemId, type, provider: contributor.id, startMs, endMs }
      if (submissions.wasSubmitted(key)) continue
      const result = await contributor.submit(target.value.ref, { type, startMs, endMs })
      submissions.record({
        ...key,
        outcome: result.ok ? 'submitted' : 'failed',
        ...(result.ok ? {} : { error: result.error.code }),
        at: clock.now(),
      })
      if (result.ok) {
        submitted += 1
        log.info('segment submitted', { provider: contributor.id, startMs, endMs })
        continue
      }
      log.warn('segment submission failed', {
        provider: contributor.id,
        code: result.error.code,
        error: result.error.message,
      })
      if (result.error.code === 'segment/provider_unavailable') {
        unavailable = { ...result.error, code: result.error.code }
      }
    }
    if (unavailable !== undefined) return err(unavailable)
    return ok(submitted > 0 ? 'submitted' : 'skipped')
  }

export type SubmitSegment = ReturnType<typeof submitSegmentFactory>
