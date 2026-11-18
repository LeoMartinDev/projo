import { appError, err, ok, type Result } from '@projo/shared'

import { addTvFavoriteFactory } from '../../src/application/tv/add-tv-favorite.ts'
import { createTvSourceFactory } from '../../src/application/tv/create-tv-source.ts'
import { deleteTvSourceFactory } from '../../src/application/tv/delete-tv-source.ts'
import { fetchTvLogosFactory } from '../../src/application/tv/fetch-tv-logos.ts'
import { fetchTvProgrammeImagesFactory } from '../../src/application/tv/fetch-tv-programme-images.ts'
import { getTvProgrammeFactory } from '../../src/application/tv/get-tv-programme.ts'
import { listTvGuideChannelsFactory } from '../../src/application/tv/list-tv-guide-channels.ts'
import { purgeTvProgrammeImagesFactory } from '../../src/application/tv/purge-tv-programme-images.ts'
import { setTvChannelGuideChannelFactory } from '../../src/application/tv/set-tv-channel-guide-channel.ts'
import { getTvChannelLogoFactory } from '../../src/application/tv/get-tv-channel-logo.ts'
import { getTvSourceFactory } from '../../src/application/tv/get-tv-source.ts'
import { listTvChannelsFactory } from '../../src/application/tv/list-tv-channels.ts'
import { listTvGuideFactory } from '../../src/application/tv/list-tv-guide.ts'
import { listTvSourceChannelsFactory } from '../../src/application/tv/list-tv-source-channels.ts'
import { listTvSourcesFactory } from '../../src/application/tv/list-tv-sources.ts'
import { purgeEndedTvProgrammesFactory } from '../../src/application/tv/purge-ended-tv-programmes.ts'
import { queueDueTvGuideRefreshesFactory } from '../../src/application/tv/queue-due-tv-guide-refreshes.ts'
import { queueDueTvSourceRefreshesFactory } from '../../src/application/tv/queue-due-tv-source-refreshes.ts'
import { refreshTvGuideFactory } from '../../src/application/tv/refresh-tv-guide.ts'
import { refreshTvSourceFactory } from '../../src/application/tv/refresh-tv-source.ts'
import { removeTvFavoriteFactory } from '../../src/application/tv/remove-tv-favorite.ts'
import { requestTvSourceRefreshFactory } from '../../src/application/tv/request-tv-source-refresh.ts'
import { setTvChannelEnabledFactory } from '../../src/application/tv/set-tv-channel-enabled.ts'
import { setTvGroupEnabledFactory } from '../../src/application/tv/set-tv-group-enabled.ts'
import { updateTvSourceFactory } from '../../src/application/tv/update-tv-source.ts'
import {
  searchNameOf,
  type TvChannel,
  type TvChannelRepository,
  type TvGroup,
} from '../../src/core/tv/channel.ts'
import {
  nowAndNextOf,
  TV_GUIDE_PAST_MS,
  type TvGuideChannel,
  type TvGuideChannelRepository,
  type TvGuideError,
  type TvGuideProgramme,
  type TvGuideRepository,
  type TvNowNext,
  type TvProgramme,
} from '../../src/core/tv/guide.ts'
import type { TvChannelProbe } from '../../src/core/tv/live.ts'
import type { TvLogo, TvLogoDownloader, TvLogoFiles } from '../../src/core/tv/logo.ts'
import type {
  TvProgrammeImageRepository,
  TvProgrammeImageWork,
} from '../../src/core/tv/programme-image.ts'
import type {
  TvChannelListing,
  TvProviderError,
  TvSourceProvider,
} from '../../src/core/tv/provider.ts'
import { guideUrlOf, type TvSource, type TvSourceRepository } from '../../src/core/tv/source.ts'
import type { TvFavoriteRepository } from '../../src/core/tv/viewer.ts'
import { createManualClock } from './clock.ts'
import { createRecordingJobQueue, createSequentialIds } from './fakes.ts'
import { silentLogger } from './logger.ts'
import { recordingOpenNotifications } from './operations-world.ts'

/** Sources in memory, like `createSqliteTvSourceRepository`. */
export const inMemoryTvSources = () => {
  const rows = new Map<string, TvSource>()
  const repository: TvSourceRepository = {
    list: () => [...rows.values()].sort((a, b) => a.name.localeCompare(b.name)),
    findById: (id) => rows.get(id),
    save: (source) => {
      const stored = rows.get(source.id)
      const { lastAttemptAt, lastRefreshAt, lastError, discoveredGuideUrl, guideAttemptAt } =
        stored ?? source
      rows.set(source.id, {
        ...source,
        failureCount: stored?.failureCount ?? source.failureCount,
        ...(lastAttemptAt === undefined ? {} : { lastAttemptAt }),
        ...(lastRefreshAt === undefined ? {} : { lastRefreshAt }),
        ...(lastError === undefined ? {} : { lastError }),
        ...(discoveredGuideUrl === undefined ? {} : { discoveredGuideUrl }),
        ...(guideAttemptAt === undefined ? {} : { guideAttemptAt }),
      })
    },
    delete: (id) => {
      rows.delete(id)
    },
    recordSuccess: ({ id, at, discoveredGuideUrl, account }) => {
      const source = rows.get(id)
      if (source === undefined) return
      const { lastError: _gone, discoveredGuideUrl: _old, maxConnections: limit, ...rest } = source
      const maxConnections = account === undefined ? limit : account.maxConnections
      rows.set(id, {
        ...rest,
        lastAttemptAt: at,
        lastRefreshAt: at,
        failureCount: 0,
        ...(discoveredGuideUrl === undefined ? {} : { discoveredGuideUrl }),
        ...(maxConnections === undefined ? {} : { maxConnections }),
      })
    },
    recordFailure: ({ id, at, error }) => {
      const source = rows.get(id)
      if (source === undefined) return 0
      const failureCount = source.failureCount + 1
      rows.set(id, { ...source, lastAttemptAt: at, lastError: error, failureCount })
      return failureCount
    },
    recordGuideAttempt: ({ id, at }) => {
      const source = rows.get(id)
      if (source !== undefined) rows.set(id, { ...source, guideAttemptAt: at })
    },
  }
  return { repository, rows }
}

/** Groups and channels in memory, like `createSqliteTvChannelRepository`. */
export const inMemoryTvChannels = () => {
  const groups = new Map<string, TvGroup>()
  const channels = new Map<string, TvChannel>()
  const probes = new Map<string, TvChannelProbe>()
  const present = (channel: TvChannel) => channel.missingSince === undefined
  const summary = (group: TvGroup) => {
    const own = [...channels.values()].filter((c) => c.groupId === group.id && present(c))
    return {
      ...group,
      channelCount: own.length,
      enabledChannelCount: own.filter((c) => c.enabled).length,
    }
  }
  const ordered = <T extends { position: number }>(values: T[]) =>
    values.sort((a, b) => a.position - b.position)

  const repository: TvChannelRepository = {
    stateOf: (sourceId) => ({
      groups: [...groups.values()].filter((g) => g.sourceId === sourceId),
      channels: [...channels.values()].filter((c) => c.sourceId === sourceId),
    }),
    applyRefresh: (plan) => {
      for (const group of plan.groups.insert) groups.set(group.id, group)
      for (const { id, position } of plan.groups.update) {
        const group = groups.get(id)
        if (group !== undefined) groups.set(id, { ...group, position })
      }
      for (const channel of plan.channels.insert) channels.set(channel.id, channel)
      for (const update of plan.channels.update) {
        const stored = channels.get(update.id)
        if (stored === undefined) continue
        const { missingSince: _m, number: _n, guideKey: _g, logoUrl: _l, ...rest } = stored
        const { number, guideKey, logoUrl, ...fields } = update
        channels.set(update.id, {
          ...rest,
          ...fields,
          ...(number === undefined ? {} : { number }),
          ...(guideKey === undefined ? {} : { guideKey }),
          ...(logoUrl === undefined ? {} : { logoUrl }),
        })
      }
      for (const id of plan.channels.markMissing.ids) {
        const stored = channels.get(id)
        if (stored !== undefined && present(stored))
          channels.set(id, { ...stored, missingSince: plan.channels.markMissing.at })
      }
      for (const id of plan.channels.delete) channels.delete(id)
      for (const id of plan.groups.delete) groups.delete(id)
    },
    countsBySource: () => {
      const counts = new Map<string, { channelCount: number; enabledChannelCount: number }>()
      for (const channel of channels.values()) {
        if (!present(channel)) continue
        const count = counts.get(channel.sourceId) ?? { channelCount: 0, enabledChannelCount: 0 }
        counts.set(channel.sourceId, {
          channelCount: count.channelCount + 1,
          enabledChannelCount: count.enabledChannelCount + (channel.enabled ? 1 : 0),
        })
      }
      return counts
    },
    groupsOf: (sourceId) =>
      ordered([...groups.values()].filter((g) => g.sourceId === sourceId)).map(summary),
    findGroup: (id) => {
      const group = groups.get(id)
      return group === undefined ? undefined : summary(group)
    },
    setGroupEnabled: ({ id, enabled }) => {
      const group = groups.get(id)
      if (group === undefined) return
      groups.set(id, { ...group, enabled })
      for (const channel of channels.values())
        if (channel.groupId === id) channels.set(channel.id, { ...channel, enabled })
    },
    findChannel: (id) => channels.get(id),
    setChannelEnabled: ({ id, enabled }) => {
      const channel = channels.get(id)
      if (channel !== undefined) channels.set(id, { ...channel, enabled })
    },
    listChannels: ({ sourceId, search, groupId, offset, limit }) => {
      const matching = ordered(
        [...channels.values()].filter(
          (c) =>
            c.sourceId === sourceId &&
            present(c) &&
            (groupId === undefined || c.groupId === groupId) &&
            (search === undefined || searchNameOf(c.name).includes(search)),
        ),
      )
      return { items: matching.slice(offset, offset + limit), total: matching.length }
    },
    logoWork: ({ sourceId, retryFailedBefore }) => {
      const own = ordered([...channels.values()].filter((c) => c.sourceId === sourceId))
      return {
        fetch: own.filter(
          (c) =>
            c.enabled &&
            present(c) &&
            c.logoUrl !== undefined &&
            (c.logoFetchedUrl !== c.logoUrl ||
              (c.logoFailedAt !== undefined &&
                c.logoFailedAt.getTime() < retryFailedBefore.getTime())),
        ),
        drop: own.filter((c) => c.logoUrl === undefined && c.logoPath !== undefined),
      }
    },
    recordLogo: ({ id, url, at, path }) => {
      const channel = channels.get(id)
      if (channel === undefined) return false
      if (path === undefined) {
        channels.set(id, { ...channel, logoFetchedUrl: url, logoFailedAt: at })
        return true
      }
      const { logoFailedAt: _failed, ...rest } = channel
      channels.set(id, { ...rest, logoFetchedUrl: url, logoFetchedAt: at, logoPath: path })
      return true
    },
    dropLogo: (id) => {
      const channel = channels.get(id)
      if (channel === undefined) return
      const {
        logoPath: _p,
        logoFetchedUrl: _u,
        logoFetchedAt: _a,
        logoFailedAt: _f,
        ...rest
      } = channel
      channels.set(id, rest)
    },
    logoPathsOf: (sourceId) =>
      [...channels.values()].flatMap((c) =>
        c.sourceId === sourceId && c.logoPath !== undefined ? [c.logoPath] : [],
      ),
    // Sources in id order here (the SQLite adapter orders them by name).
    listViewable: () => {
      const rank = (c: TvChannel) => groups.get(c.groupId)?.position ?? 0
      const listed = [...channels.values()]
        .filter((c) => c.enabled && present(c))
        .sort(
          (a, b) =>
            a.sourceId.localeCompare(b.sourceId) || rank(a) - rank(b) || a.position - b.position,
        )
      const seen = new Map<string, TvGroup>()
      for (const c of listed) {
        const group = groups.get(c.groupId)
        if (group !== undefined && !seen.has(group.id)) seen.set(group.id, group)
      }
      return { groups: [...seen.values()], channels: listed }
    },
    guideTargetsOf: (sourceId) =>
      [...channels.values()]
        .filter((c) => c.sourceId === sourceId && c.enabled && present(c))
        .sort((a, b) => a.position - b.position)
        .map(({ id, name, groupId, guideKey, guideChannel }) => ({
          id,
          name,
          group: groups.get(groupId)?.name ?? '',
          ...(guideKey === undefined ? {} : { guideKey }),
          ...(guideChannel === undefined ? {} : { guideChannel }),
        })),
    recordGuideMatches: (matches) => {
      for (const [id, matched] of matches) {
        const channel = channels.get(id)
        if (channel !== undefined) channels.set(id, { ...channel, guideMatched: matched ?? '' })
      }
    },
    setGuideChannel: ({ id, guideChannel }) => {
      const channel = channels.get(id)
      if (channel === undefined) return
      const { guideChannel: _previous, ...rest } = channel
      channels.set(id, guideChannel === undefined ? rest : { ...rest, guideChannel })
    },
    probeOf: (id) => probes.get(id),
    recordProbe: ({ id, probe }) => {
      if (probe === undefined) probes.delete(id)
      else probes.set(id, probe)
    },
  }
  return { repository, groups, channels, probes }
}

/** The guide's programmes in memory, like `createSqliteTvGuideRepository`. */
export const inMemoryTvGuide = (channels: ReturnType<typeof inMemoryTvChannels>['channels']) => {
  let programmes: TvProgramme[] = []
  let nextId = 0
  const keptAfter = (now: Date) => now.getTime() - TV_GUIDE_PAST_MS
  const repository: TvGuideRepository = {
    replaceForSource: ({ sourceId, programmes: replacement, now }) => {
      const own = new Set(
        [...channels.values()].filter((c) => c.sourceId === sourceId).map((c) => c.id),
      )
      const known = new Map(
        programmes.map((p) => [`${p.channelId}|${p.startAt.toISOString()}`, p.id]),
      )
      programmes = [
        ...programmes.filter((p) => !own.has(p.channelId)),
        ...replacement
          .filter((p) => own.has(p.channelId))
          .map((p) => {
            nextId += 1
            return {
              ...p,
              id: known.get(`${p.channelId}|${p.startAt.toISOString()}`) ?? `programme-${nextId}`,
              ...(p.imageUrl === undefined ? {} : { imageKey: `key:${p.imageUrl}` }),
              imageStored: false,
            }
          }),
      ].filter((p) => p.endAt.getTime() > keptAfter(now))
    },
    deleteEnded: (now) => {
      const before = programmes.length
      programmes = programmes.filter((p) => p.endAt.getTime() > keptAfter(now))
      return before - programmes.length
    },
    findProgramme: (id) =>
      programmes.find((p) => p.id === id && channels.get(p.channelId)?.missingSince === undefined),
    programmeAfter: ({ channelId, at }) =>
      programmes
        .filter((p) => p.channelId === channelId && p.startAt.getTime() >= at.getTime())
        .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())[0],
    nowAndNext: (at) => {
      const guide = new Map<string, TvNowNext>()
      for (const channel of channels.values()) {
        if (!channel.enabled || channel.missingSince !== undefined) continue
        const own = programmes
          .filter((p) => p.channelId === channel.id && p.endAt.getTime() > at.getTime())
          .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
          .slice(0, 2)
        const entry = nowAndNextOf(own, at)
        if (entry.now !== undefined || entry.next !== undefined) guide.set(channel.id, entry)
      }
      return guide
    },
  }
  return { repository, programmes: () => programmes }
}

/** Favourites in memory, like `createSqliteTvFavoriteRepository`. */
export const inMemoryTvFavorites = () => {
  const rows: { profileId: string; channelId: string }[] = []
  const repository: TvFavoriteRepository = {
    listOf: (profileId) => rows.filter((r) => r.profileId === profileId).map((r) => r.channelId),
    add: ({ profileId, channelId }) => {
      if (!rows.some((r) => r.profileId === profileId && r.channelId === channelId))
        rows.push({ profileId, channelId })
    },
    remove: ({ profileId, channelId }) => {
      const index = rows.findIndex((r) => r.profileId === profileId && r.channelId === channelId)
      if (index !== -1) rows.splice(index, 1)
    },
  }
  return { repository, rows }
}

/** Guide channels in memory, like `createSqliteTvGuideChannelRepository`. */
export const inMemoryTvGuideChannels = () => {
  const bySource = new Map<string, TvGuideChannel[]>()
  const repository: TvGuideChannelRepository = {
    replaceForSource: ({ sourceId, channels }) => {
      bySource.set(sourceId, [...channels])
    },
    list: ({ sourceId, search, offset, limit }) => {
      const all = (bySource.get(sourceId) ?? []).filter(
        (channel) =>
          search === undefined ||
          searchNameOf([channel.id, ...channel.names].join('\n')).includes(search),
      )
      return { items: all.slice(offset, offset + limit), total: all.length }
    },
    findMany: ({ sourceId, ids }) => {
      const wanted = new Set(ids)
      return new Map(
        (bySource.get(sourceId) ?? [])
          .filter((channel) => wanted.has(channel.id))
          .map((channel) => [channel.id.toLowerCase(), channel]),
      )
    },
  }
  return { repository, bySource }
}

/**
 * Programme images in memory, like `createSqliteTvProgrammeImageRepository`: the work is the
 * in-memory guide's now and next.
 */
export const inMemoryTvProgrammeImages = (
  guide: ReturnType<typeof inMemoryTvGuide>,
  channels: ReturnType<typeof inMemoryTvChannels>['channels'],
) => {
  const rows = new Map<string, { path?: string; fetchedAt?: Date; failedAt?: Date }>()
  const repository: TvProgrammeImageRepository = {
    work: ({ at, retryFailedBefore, refetchBefore }) => {
      const found = new Map<string, TvProgrammeImageWork>()
      for (const [channelId, entry] of guide.repository.nowAndNext(at)) {
        for (const programme of [entry.now, entry.next]) {
          if (programme?.imageKey === undefined || programme.imageUrl === undefined) continue
          const row = rows.get(programme.imageKey)
          const due =
            row === undefined ||
            (row.failedAt !== undefined && row.failedAt < retryFailedBefore) ||
            (row.failedAt === undefined &&
              row.fetchedAt !== undefined &&
              row.fetchedAt < refetchBefore)
          const sourceId = channels.get(channelId)?.sourceId
          if (due && sourceId !== undefined && !found.has(programme.imageKey))
            found.set(programme.imageKey, {
              key: programme.imageKey,
              url: programme.imageUrl,
              sourceId,
            })
        }
      }
      return [...found.values()]
    },
    record: ({ key, at, path }) => {
      const row = rows.get(key) ?? {}
      rows.set(key, path === undefined ? { ...row, failedAt: at } : { path, fetchedAt: at })
    },
    pathOf: (key) => rows.get(key)?.path,
    purgeUnreferenced: () => {
      const referenced = new Set(guide.programmes().flatMap((p) => p.imageKey ?? []))
      const paths: string[] = []
      for (const [key, row] of rows)
        if (!referenced.has(key)) {
          rows.delete(key)
          if (row.path !== undefined) paths.push(row.path)
        }
      return paths
    },
  }
  return { repository, rows }
}

/** What a scripted guide hands its sink: XMLTV channels, then programmes. */
export type ScriptedGuide = { channels?: TvGuideChannel[]; programmes: TvGuideProgramme[] }

/** A provider answering what the test scripts: a listing or a failure, a guide or a failure. */
export const scriptedTvProvider = () => {
  let answer: Result<TvChannelListing, TvProviderError> = ok({ channels: [] })
  let guide: Result<ScriptedGuide | undefined, TvGuideError> = ok(undefined)
  const calls: string[] = []
  const guideReads: string[] = []
  const provider: TvSourceProvider = {
    listChannels: async ({ settings }) => {
      calls.push(
        settings.kind === 'm3u'
          ? settings.playlistUrl
          : settings.kind === 'xtream'
            ? settings.serverUrl
            : settings.address,
      )
      return answer
    },
    readGuide: async ({ source, sink }) => {
      guideReads.push(guideUrlOf(source.settings) ?? source.discoveredGuideUrl ?? '')
      if (!guide.ok) return guide
      if (guide.value === undefined) return ok({ available: false })
      for (const channel of guide.value.channels ?? []) sink.channel(channel)
      for (const programme of guide.value.programmes) sink.programme(programme)
      return ok({ available: true })
    },
    upstreamOf: ({ upstream }) => upstream,
  }
  return {
    provider,
    calls,
    guideReads,
    /** The guide the next reads hand out; `undefined`: the source has none. */
    guide: (value: ScriptedGuide | undefined) => {
      guide = ok(value)
    },
    failGuide: (code: TvGuideError['code'] = 'tv/guide_unreachable') => {
      guide = err(appError(code, 'scripted guide failure'))
    },
    answer: (listing: TvChannelListing) => {
      answer = ok(listing)
    },
    fail: (code: TvProviderError['code'] = 'tv/source_unreachable') => {
      answer = err(appError(code, 'scripted failure'))
    },
  }
}

/**
 * Logos by URL: a URL listed in `images` answers that image, any other fails. `duringDownload`
 * runs inside each download (something happening meanwhile: a deletion, a shutdown).
 */
export const scriptedLogos = () => {
  const images = new Map<string, TvLogo>()
  const downloads: { url: string; userAgent?: string }[] = []
  const files = new Map<string, Uint8Array>()
  const hooks: { duringDownload?: (url: string) => Promise<void> } = {}
  const downloader: TvLogoDownloader = {
    download: async ({ url, userAgent }) => {
      downloads.push({ url, ...(userAgent === undefined ? {} : { userAgent }) })
      await hooks.duringDownload?.(url)
      const image = images.get(url)
      return image === undefined
        ? err(
            appError('tv/logo_unavailable', 'scripted failure', {
              context: { reason: 'http_404' },
            }),
          )
        : ok(image)
    },
  }
  const logoFiles: TvLogoFiles = {
    write: async ({ path, bytes }) => {
      files.set(path, bytes)
      return ok()
    },
    remove: async (path) => {
      files.delete(path)
    },
    absolutePath: (path) => `/images/${path}`,
  }
  return { images, downloads, files, hooks, downloader, logoFiles }
}

/** The TV use cases over in-memory sources, channels, provider, logos and job queue. */
export const createTvWorld = () => {
  const clock = createManualClock(new Date('2026-06-10T10:00:00.000Z'))
  const ids = createSequentialIds('tv-')
  const sources = inMemoryTvSources()
  const channels = inMemoryTvChannels()
  const provider = scriptedTvProvider()
  const logos = scriptedLogos()
  const notifications = recordingOpenNotifications()
  const { queue: jobQueue, enqueued } = createRecordingJobQueue()
  const refreshing = new Set<string>()
  const tvSources = sources.repository
  const tvChannels = channels.repository
  const refreshActivity = { refreshingSourceIds: () => refreshing }
  const logger = silentLogger
  const guide = inMemoryTvGuide(channels.channels)
  const guideChannels = inMemoryTvGuideChannels()
  const programmeImages = inMemoryTvProgrammeImages(guide, channels.channels)
  const favorites = inMemoryTvFavorites()
  // Profiles whose Live TV access is off (§29.6).
  const withoutLiveTv = new Set<string>()
  const tvAccess = { hasLiveTv: (profileId: string) => !withoutLiveTv.has(profileId) }
  let guideLanguage = 'fr-FR'

  const createTvSource = createTvSourceFactory({ tvSources, jobQueue, ids, clock, logger })

  return {
    clock,
    sources,
    channels,
    provider,
    logos,
    notifications,
    enqueued,
    refreshing,
    guide,
    guideChannels,
    programmeImages,
    favorites,
    withoutLiveTv,
    setGuideLanguage: (language: string) => {
      guideLanguage = language
    },
    createTvSource,
    /** `createTvSource` for a test's setup: the created source, or a thrown error. */
    addTvSource: (input: Parameters<typeof createTvSource>[0]) => {
      const created = createTvSource(input)
      if (!created.ok) throw new Error(created.error.message)
      return created.value
    },
    updateTvSource: updateTvSourceFactory({
      tvSources,
      tvChannels,
      refreshActivity,
      jobQueue,
      logger,
    }),
    deleteTvSource: deleteTvSourceFactory({
      tvSources,
      tvChannels,
      // The snapshots' paths of a source (§29.4): its channels' that hold one.
      snapshots: { snapshotPathsOf: () => [] },
      logoFiles: logos.logoFiles,
      logger,
    }),
    listTvSources: listTvSourcesFactory({ tvSources, tvChannels, refreshActivity }),
    getTvSource: getTvSourceFactory({ tvSources, tvChannels, refreshActivity }),
    requestTvSourceRefresh: requestTvSourceRefreshFactory({ tvSources, jobQueue }),
    queueDueTvSourceRefreshes: queueDueTvSourceRefreshesFactory({ tvSources, jobQueue, clock }),
    refreshTvSource: refreshTvSourceFactory({
      tvSources,
      tvChannels,
      provider: provider.provider,
      logoFiles: logos.logoFiles,
      notifier: notifications.notifier,
      jobQueue,
      ids,
      clock,
      logger,
    }),
    setTvGroupEnabled: setTvGroupEnabledFactory({ tvSources, tvChannels, jobQueue, logger }),
    setTvChannelEnabled: setTvChannelEnabledFactory({ tvChannels, jobQueue }),
    listTvSourceChannels: listTvSourceChannelsFactory({
      tvSources,
      tvChannels,
      guideChannels: guideChannels.repository,
    }),
    listTvGuideChannels: listTvGuideChannelsFactory({
      tvSources,
      guideChannels: guideChannels.repository,
    }),
    setTvChannelGuideChannel: setTvChannelGuideChannelFactory({ tvChannels, jobQueue }),
    getTvProgramme: getTvProgrammeFactory({
      guide: guide.repository,
      tvChannels,
      tvAccess,
      clock,
    }),
    fetchTvProgrammeImages: fetchTvProgrammeImagesFactory({
      tvSources,
      images: programmeImages.repository,
      downloader: logos.downloader,
      files: logos.logoFiles,
      clock,
      logger,
    }),
    purgeTvProgrammeImages: purgeTvProgrammeImagesFactory({
      images: programmeImages.repository,
      files: logos.logoFiles,
    }),
    fetchTvLogos: fetchTvLogosFactory({
      tvSources,
      tvChannels,
      downloader: logos.downloader,
      logoFiles: logos.logoFiles,
      clock,
      logger,
    }),
    getTvChannelLogo: getTvChannelLogoFactory({
      tvChannels,
      tvAccess,
      logoFiles: logos.logoFiles,
    }),
    refreshTvGuide: refreshTvGuideFactory({
      tvSources,
      tvChannels,
      guide: guide.repository,
      guideChannels: guideChannels.repository,
      provider: provider.provider,
      guideLanguage: () => guideLanguage,
      jobQueue,
      clock,
      logger,
    }),
    queueDueTvGuideRefreshes: queueDueTvGuideRefreshesFactory({ tvSources, jobQueue, clock }),
    purgeEndedTvProgrammes: purgeEndedTvProgrammesFactory({ guide: guide.repository, clock }),
    listTvChannels: listTvChannelsFactory({
      tvChannels,
      tvAccess,
      favorites: favorites.repository,
      guide: guide.repository,
      clock,
    }),
    listTvGuide: listTvGuideFactory({ tvAccess, guide: guide.repository, clock }),
    addTvFavorite: addTvFavoriteFactory({
      tvChannels,
      tvAccess,
      favorites: favorites.repository,
      clock,
    }),
    removeTvFavorite: removeTvFavoriteFactory({
      tvChannels,
      tvAccess,
      favorites: favorites.repository,
    }),
  }
}

export type TvWorld = ReturnType<typeof createTvWorld>
