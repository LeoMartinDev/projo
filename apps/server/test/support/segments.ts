import { appError, err, ok } from '@projo/shared'

import type { PlayableSource } from '../../src/core/catalog/catalog.ts'
import type { SegmentCatalog, SegmentItemFacts } from '../../src/core/segments/catalog.ts'
import {
  canReplace,
  type Segment,
  type SegmentContributor,
  type SegmentItemRef,
  type SegmentLookup,
  type SegmentLookupRow,
  type SegmentProvider,
  type SegmentProviderId,
  type SegmentRepository,
  type SegmentSubmissionRepository,
} from '../../src/core/segments/segment.ts'
import type { SegmentSettingsStore } from '../../src/core/segments/settings-store.ts'
import { defaultSegmentSettings, type SegmentSettings } from '../../src/core/settings/settings.ts'
import type { SegmentProviders } from '../../src/infrastructure/segments/providers.ts'

/** In-memory `SegmentRepository` applying the §12.1 priority rule like the SQLite one. */
export const inMemorySegments = (now: () => Date = () => new Date(0)) => {
  const segments = new Map<string, Segment>()
  const lookups = new Map<string, SegmentLookupRow>()
  let counter = 0
  const repository: SegmentRepository = {
    listByItem: (itemId) =>
      [...segments.values()]
        .filter((segment) => segment.itemId === itemId)
        .sort((a, b) => a.startMs - b.startMs),
    find: ({ itemId, type }) => segments.get(`${itemId}/${type}`),
    save: ({ itemId, origin, candidate }) => {
      const key = `${itemId}/${candidate.type}`
      const existing = segments.get(key)
      if (!canReplace(existing?.origin, origin)) return undefined
      if (origin !== 'manual' && lookups.has(`${itemId}/no_segment:${candidate.type}`)) {
        return undefined
      }
      counter += 1
      const segment: Segment = {
        id: existing?.id ?? `segment-${counter}`,
        itemId,
        type: candidate.type,
        startMs: Math.round(candidate.startMs),
        endMs: Math.round(candidate.endMs),
        origin,
        ...(candidate.confidence === undefined ? {} : { confidence: candidate.confidence }),
        createdAt: now(),
      }
      segments.set(key, segment)
      return segment
    },
    remove: ({ itemId, type }) => segments.delete(`${itemId}/${type}`),
    listLookups: (itemId) => [...lookups.values()].filter((row) => row.itemId === itemId),
    saveLookup: (row) => void lookups.set(`${row.itemId}/${row.provider}`, row),
    removeLookup: ({ itemId, provider }) => void lookups.delete(`${itemId}/${provider}`),
  }
  return { repository, segments, lookups }
}

/** In-memory `segments.*` settings. */
export const inMemorySegmentSettings = (initial: Partial<SegmentSettings> = {}) => {
  let current: SegmentSettings = { ...defaultSegmentSettings, ...initial }
  const store: SegmentSettingsStore = {
    read: () => current,
    write: (input) => {
      const { theintrodbApiKey: _key, ...rest } = current
      const key = 'theintrodbApiKey' in input ? input.theintrodbApiKey : current.theintrodbApiKey
      current = {
        ...rest,
        ...(key === undefined ? {} : { theintrodbApiKey: key }),
        ...(input.providers === undefined ? {} : { providers: input.providers }),
        ...(input.contribution === undefined ? {} : { contribution: input.contribution }),
        fingerprint: {
          ...current.fingerprint,
          ...Object.fromEntries(
            Object.entries(input.fingerprint ?? {}).filter(([, v]) => v !== undefined),
          ),
        },
      }
    },
    saveSkipdbAnonymousKey: (skipdbAnonymousKey) => {
      current = { ...current, skipdbAnonymousKey }
    },
  }
  return store
}

/** Item facts for the in-memory catalog; `sharesFile` defaults to false. */
export type FactsInput = Omit<SegmentItemFacts, 'sharesFile'> & { sharesFile?: boolean }

/** In-memory `SegmentCatalog`: `items` by id; seasons from `seasonId`. */
export const inMemorySegmentCatalog = (items: FactsInput[]): SegmentCatalog => ({
  findItem: (itemId) => {
    const item = items.find((entry) => entry.itemId === itemId)
    return item === undefined ? undefined : { sharesFile: false, ...item }
  },
  listSeasonEpisodeIds: (seasonId) =>
    items
      .filter((item) => item.kind === 'episode' && item.seasonId === seasonId)
      .sort((a, b) => (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0))
      .map((item) => item.itemId),
  listUnidentifiedItemIds: () => [],
  listItemsToResolve: () => [],
})

/** A ready source of `durationMs` with `chapters`, for `listReadySources`. */
export const readySource = (
  id: string,
  durationMs: number,
  chapters: { startMs: number; endMs: number; title?: string }[] = [],
): PlayableSource => ({
  id,
  state: 'ready',
  libraryId: 'library-1',
  path: `/media/${id}.mkv`,
  rootReachable: true,
  extension: 'mkv',
  sizeBytes: 1,
  mtime: 1,
  version: {},
  media: { durationMs, video: [{ index: 0, codec: 'h264' }], audio: [], subtitles: [], chapters },
})

type Answer = SegmentLookup | 'unavailable' | 'rate_limited'

/**
 * Fake providers: `answers[provider](item)` decides the answer (default: nothing found); every
 * call is recorded in `calls`. Contributors record their submissions in `submitted`.
 */
export const fakeSegmentProviders = (
  answers: Partial<Record<SegmentProviderId, (item: SegmentItemRef) => Answer>> = {},
  { submitFails }: { submitFails?: Partial<Record<SegmentContributor['id'], boolean>> } = {},
) => {
  const calls: { provider: SegmentProviderId; itemId: string; durationMs?: number }[] = []
  const submitted: { provider: SegmentContributor['id']; itemId: string; startMs: number }[] = []
  const validatedKeys: string[] = []
  const provider = (id: SegmentProviderId): SegmentProvider => ({
    id,
    lookup: async (item, durationMs) => {
      calls.push({
        provider: id,
        itemId: item.itemId,
        ...(durationMs === undefined ? {} : { durationMs }),
      })
      const answer = answers[id]?.(item) ?? { segments: [], absent: [] }
      if (answer === 'unavailable') {
        return err(appError('segment/provider_unavailable', `${id} unreachable`))
      }
      if (answer === 'rate_limited') {
        return err(appError('segment/provider_rate_limited', `${id} answered 429`))
      }
      return ok(answer)
    },
  })
  const contributor = (id: SegmentContributor['id']): SegmentContributor => ({
    id,
    submit: async (item, segment) => {
      if (submitFails?.[id] === true) {
        return err(appError('segment/provider_unavailable', `${id} unreachable`))
      }
      submitted.push({ provider: id, itemId: item.itemId, startMs: segment.startMs })
      return ok()
    },
  })
  const providers: SegmentProviders = {
    providers: {
      theintrodb: provider('theintrodb'),
      introdb: provider('introdb'),
      skipdb: provider('skipdb'),
    },
    contributors: { theintrodb: contributor('theintrodb'), skipdb: contributor('skipdb') },
    validateTheintrodbKey: async (key) => {
      validatedKeys.push(key)
      return key.startsWith('good')
        ? ok()
        : err(appError('segment/theintrodb_key_invalid', 'TheIntroDB refused this key'))
    },
  }
  return { providers, calls, submitted, validatedKeys }
}

/** In-memory `segment_submissions`. */
export const inMemorySubmissions = () => {
  const rows: Parameters<SegmentSubmissionRepository['record']>[0][] = []
  const repository: SegmentSubmissionRepository = {
    record: (row) => void rows.push(row),
    wasSubmitted: (key) =>
      rows.some(
        (row) =>
          row.outcome === 'submitted' &&
          row.itemId === key.itemId &&
          row.type === key.type &&
          row.provider === key.provider &&
          row.startMs === key.startMs &&
          row.endMs === key.endMs,
      ),
  }
  return { repository, rows }
}
