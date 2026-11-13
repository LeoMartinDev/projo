import { z } from 'zod'

import { ok } from '@projo/shared'

import { fetchSegmentsFactory } from '../../application/segments/fetch-segments.ts'
import {
  getItemSegmentsFactory,
  segmentMarkersFactory,
} from '../../application/segments/markers.ts'
import {
  requestMissingSegmentsFactory,
  requestSegmentsAfterEnrichmentFactory,
  requestSegmentsOfUnidentifiedSourceFactory,
} from '../../application/segments/request-segments.ts'
import { segmentSettingsAdminFactory } from '../../application/segments/segment-settings.ts'
import { submitSegmentFactory } from '../../application/segments/submit-segment.ts'
import { segmentTargetFactory } from '../../application/segments/targets.ts'
import { segmentTypes } from '../../core/segments/segment.ts'
import {
  createSegmentProviders,
  type SegmentProviders,
} from '../../infrastructure/segments/providers.ts'
import { createSqliteCatalog } from '../../infrastructure/sqlite/catalog.ts'
import { createSqliteSegmentCatalog } from '../../infrastructure/sqlite/segment-catalog.ts'
import {
  createSqliteSegmentRepository,
  createSqliteSegmentSubmissionRepository,
} from '../../infrastructure/sqlite/segment-repository.ts'
import { createSqliteSegmentSettings } from '../../infrastructure/sqlite/segment-settings.ts'
import { adminSegmentsRoutes } from '../http/routes/admin-segments.ts'
import { segmentsRoutes } from '../http/routes/segments.ts'
import { defineJobHandlers } from '../jobs/handler.ts'
import type { ScopeDeps } from './catalog.ts'
import type { Platform } from './platform.ts'
import { defineModule } from './types.ts'

const itemPayload = z.object({ itemId: z.string().min(1) })
const sourcePayload = z.object({ sourceId: z.string().min(1) })
const submitPayload = z.object({ itemId: z.string().min(1), type: z.enum(segmentTypes) })

const hour = 60 * 60_000

export type SegmentsModuleOptions = ScopeDeps & {
  providerBaseUrls?: { theintrodb?: string; introdb?: string; skipdb?: string }
  segmentProviders?: SegmentProviders
}

export const buildSegmentsModule = (
  platform: Platform,
  { visibilityScope, providerBaseUrls, segmentProviders }: SegmentsModuleOptions,
) => {
  const { db, ids, clock, logger, eventBus, jobQueue } = platform
  const moduleLogger = logger.child({ module: 'segments' })
  const store = createSqliteSegmentSettings({ db })
  const providers =
    segmentProviders ??
    createSegmentProviders({
      ...(providerBaseUrls === undefined ? {} : { baseUrls: providerBaseUrls }),
      theintrodbApiKey: () => store.read().theintrodbApiKey,
      skipdbAnonymousKey: () => store.read().skipdbAnonymousKey,
      saveSkipdbAnonymousKey: (key) => store.saveSkipdbAnonymousKey(key, clock.now()),
      logger: logger.child({ module: 'segment-providers' }),
    })
  const catalog = createSqliteCatalog({ db })
  const segmentCatalog = createSqliteSegmentCatalog({ db })
  const segmentRepository = createSqliteSegmentRepository({ db, ids, clock })
  const submissions = createSqliteSegmentSubmissionRepository({ db, ids })
  const segmentTarget = segmentTargetFactory({ segmentCatalog, playableSources: catalog })

  const fetchSegments = fetchSegmentsFactory({
    segmentTarget,
    segmentRepository,
    providers: providers.providers,
    settings: store,
    jobQueue,
    clock,
    logger: moduleLogger,
  })
  const submitSegment = submitSegmentFactory({
    segmentTarget,
    segmentRepository,
    submissions,
    contributors: providers.contributors,
    settings: store,
    clock,
    logger: moduleLogger,
  })
  const markers = segmentMarkersFactory({
    segmentTarget,
    segmentCatalog,
    segmentRepository,
    settings: store,
    jobQueue,
    clock,
    logger: moduleLogger,
  })
  const requestAfterEnrichment = requestSegmentsAfterEnrichmentFactory({
    segmentCatalog,
    jobQueue,
  })
  const requestMissingSegments = requestMissingSegmentsFactory({
    segmentCatalog,
    jobQueue,
    settings: store,
    clock,
  })
  const requestForUnidentifiedSource = requestSegmentsOfUnidentifiedSourceFactory({
    segmentCatalog,
    jobQueue,
  })

  const unsubscribe = eventBus.on('job.finished', (job) => {
    if (job.type === 'fetch_images') {
      const payload = itemPayload.safeParse(job.payload)
      if (payload.success) requestAfterEnrichment(payload.data.itemId)
    } else if (job.type === 'match_source') {
      const payload = sourcePayload.safeParse(job.payload)
      if (payload.success) requestForUnidentifiedSource(payload.data.sourceId)
    }
  })

  return defineModule({
    exposes: {
      /** The "Intros and credits" section of the admin settings, served by the settings module. */
      settings: segmentSettingsAdminFactory({
        store,
        validateTheintrodbKey: providers.validateTheintrodbKey,
        clock,
        logger: moduleLogger,
      }),
      routes: {
        segments: segmentsRoutes({
          getItemSegments: getItemSegmentsFactory({
            visibleItems: catalog,
            playableSources: catalog,
            segmentRepository,
            visibilityScope,
          }),
        }),
        adminSegments: adminSegmentsRoutes({
          setManualSegment: markers.setManualSegment,
          removeSegment: markers.removeSegment,
          applyToSeason: markers.applyToSeason,
        }),
      },
    },
    jobHandlers: defineJobHandlers({
      fetch_segments: {
        payload: itemPayload,
        concurrency: 1,
        run: async ({ itemId }, { signal }) => {
          await fetchSegments({ itemId, signal })
          return ok()
        },
      },
      submit_segment: {
        payload: submitPayload,
        concurrency: 1,
        run: async (payload) => {
          const result = await submitSegment(payload)
          return result.ok ? ok() : result
        },
      },
    }),
    scheduledTasks: [
      {
        name: 'segments-backfill',
        initialDelayMs: 3 * 60_000,
        intervalMs: 24 * hour,
        run: () => {
          const queued = requestMissingSegments()
          if (queued > 0) moduleLogger.info('segments queued for existing items', { queued })
        },
      },
    ],
    stop: () => {
      unsubscribe()
    },
  })
}

export type SegmentsModule = ReturnType<typeof buildSegmentsModule>
