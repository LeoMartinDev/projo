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
import type { SegmentSettingsAdmin } from '../../application/segments/types.ts'
import { segmentTypes } from '../../core/segments/segment.ts'
import type { SegmentSettingsStore } from '../../core/segments/settings-store.ts'
import {
  createSegmentProviders,
  type SegmentProviders,
} from '../../infrastructure/segments/providers.ts'
import { createSqliteCatalogRepository } from '../../infrastructure/sqlite/catalog-repository.ts'
import { createSqliteSegmentCatalog } from '../../infrastructure/sqlite/segment-catalog.ts'
import {
  createSqliteSegmentRepository,
  createSqliteSegmentSubmissionRepository,
} from '../../infrastructure/sqlite/segment-repository.ts'
import { createSqliteSegmentSettings } from '../../infrastructure/sqlite/segment-settings.ts'
import { adminSegmentsRoutes } from '../http/routes/admin-segments.ts'
import { segmentsRoutes } from '../http/routes/segments.ts'
import { defineJobHandler } from '../jobs/handler.ts'
import { allVisible, type ScopeDeps } from './catalog.ts'
import type { Platform } from './platform.ts'

const itemPayload = z.object({ itemId: z.string().min(1) })
const sourcePayload = z.object({ sourceId: z.string().min(1) })
const submitPayload = z.object({ itemId: z.string().min(1), type: z.enum(segmentTypes) })

const hour = 60 * 60_000

type ProviderOptions = {
  /** Tests: local servers replaying recorded provider responses. */
  providerBaseUrls?: { theintrodb?: string; introdb?: string; skipdb?: string }
  /** Tests: in-memory providers instead of the HTTP adapters. */
  segmentProviders?: SegmentProviders
}

/** The `segments.*` settings and the TheIntroDB / IntroDB / SkipDB adapters reading them. */
const segmentInfrastructure = (
  { db, clock, logger }: Platform,
  { providerBaseUrls, segmentProviders }: ProviderOptions,
): { store: SegmentSettingsStore; providers: SegmentProviders } => {
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
  return { store, providers }
}

const settingsAdmin = (
  platform: Platform,
  { store, providers }: { store: SegmentSettingsStore; providers: SegmentProviders },
): SegmentSettingsAdmin =>
  segmentSettingsAdminFactory({
    store,
    validateTheintrodbKey: providers.validateTheintrodbKey,
    clock: platform.clock,
    logger: platform.logger.child({ module: 'segments' }),
  })

/**
 * §15 "Intros and credits" settings (`settings` table, `segments.*` keys): the section of
 * `GET/PATCH /admin/settings`, built here and passed to the metadata module that serves the route.
 */
export const buildSegmentSettingsAdmin = (
  platform: Platform,
  options: ProviderOptions = {},
): SegmentSettingsAdmin => settingsAdmin(platform, segmentInfrastructure(platform, options))

export type SegmentsModuleOptions = ScopeDeps & ProviderOptions

/**
 * Wiring of §12 (except fingerprinting, `modules/fingerprint.ts`): the resolution chain
 * (`fetch_segments` after the enrichment of a movie or an episode, and a daily backfill),
 * chapters, providers and their cache, manual markers and their contribution (`submit_segment`),
 * `GET /items/:id/segments`.
 */
export const buildSegmentsModule = (
  platform: Platform,
  { visibilityScope = allVisible, ...providerOptions }: SegmentsModuleOptions = {},
) => {
  const { db, ids, clock, logger, eventBus, jobQueue, jobRepository } = platform
  const moduleLogger = logger.child({ module: 'segments' })
  const infrastructure = segmentInfrastructure(platform, providerOptions)
  const { store, providers } = infrastructure
  const catalogRepository = createSqliteCatalogRepository({ db })
  const segmentCatalog = createSqliteSegmentCatalog({ db })
  const segmentRepository = createSqliteSegmentRepository({ db, ids, clock })
  const submissions = createSqliteSegmentSubmissionRepository({ db, ids })
  const segmentTarget = segmentTargetFactory({ segmentCatalog, catalogRepository })

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
    segmentRepository,
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

  // §12.2 / §18: after the enrichment of a movie or an episode. Every enriched episode gets its
  // own `fetch_images` (`requestImages`); a failed one still leaves the chapters to read. A file
  // `match_source` left unidentified gets no enrichment: its chapters are read right away.
  const unsubscribe = eventBus.subscribe((event) => {
    if (event.type !== 'job.updated') return
    if (event.payload.state !== 'done' && event.payload.state !== 'failed') return
    if (event.payload.type === 'fetch_images') {
      const payload = itemPayload.safeParse(jobRepository.findById(event.payload.jobId)?.payload)
      if (payload.success) requestAfterEnrichment(payload.data.itemId)
    } else if (event.payload.type === 'match_source') {
      const payload = sourcePayload.safeParse(jobRepository.findById(event.payload.jobId)?.payload)
      if (payload.success) requestForUnidentifiedSource(payload.data.sourceId)
    }
  })

  return {
    segmentSettings: settingsAdmin(platform, infrastructure),
    routes: {
      segments: segmentsRoutes({
        getItemSegments: getItemSegmentsFactory({
          catalogRepository,
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
    jobHandlers: {
      fetch_segments: defineJobHandler({
        payload: itemPayload,
        // §18: one at a time (the databases are asked episode by episode, never in bulk).
        concurrency: 1,
        run: async ({ itemId }, { signal }) => {
          await fetchSegments({ itemId, signal })
          return ok()
        },
      }),
      submit_segment: defineJobHandler({
        payload: submitPayload,
        concurrency: 1,
        run: async (payload) => {
          const result = await submitSegment(payload)
          return result.ok ? ok() : result
        },
      }),
    },
    scheduledTasks: [
      {
        // Movies and episodes identified before M4, or whose enrichment never ended.
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
  }
}

export type SegmentsModule = ReturnType<typeof buildSegmentsModule>
