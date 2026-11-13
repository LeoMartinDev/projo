import { appError, type AppError, err, ok, type Result } from '@projo/shared'
import type { ClientCapabilities, PlaybackQuality } from '@projo/shared/api/playback'

import {
  type CatalogItem,
  everything,
  isPlayableKind,
  type MediaSegment,
  type PlayableSource,
  type PlayableSources,
  type VisibilityScope,
  type VisibleItems,
} from '../../core/catalog/catalog.ts'
import type { SessionTokens } from '../../core/auth/ports.ts'
import type { Clock } from '../../core/clock.ts'
import type { IdGenerator } from '../../core/ids.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import type { Logger } from '../../core/logger.ts'
import type { SourceVersion } from '../../core/media/version.ts'
import {
  type AudioDelivery,
  availableQualities,
  decidePlayback,
  effectiveQuality,
  type PlaybackPlan,
} from '../../core/playback/decide-mode.ts'
import { planTranscodeSegments, seekPointsOf } from '../../core/playback/hls-playlist.ts'
import type { AudioStreamInfo, MediaInfo, MediaProber } from '../../core/playback/media-info.ts'
import { isFreshIndex, type KeyframeStore } from '../../core/playback/ports.ts'
import {
  equivalentSubtitle,
  type ProfileTrackDefaults,
  type ResolvedTracks,
  resolveTracks,
} from '../../core/playback/resolve-tracks.ts'
import {
  isExpired,
  type PlaybackSession,
  type PlaybackSessionRepository,
} from '../../core/playback/session.ts'
import {
  engineSubtitleDelivery,
  type SubtitleTrack,
  type SubtitleTrackRepository,
} from '../../core/playback/subtitles.ts'
import type { TrackPreferenceRepository } from '../../core/playback/track-preferences.ts'
import {
  groupVersions,
  partAt,
  partsTimeline,
  type PlaybackVersion,
  rankVersions,
  type TimelinePart,
  totalDurationMs,
  versionOf,
} from '../../core/playback/versions.ts'
import {
  applyPosition,
  creditsStartOf,
  type ProgressRepository,
  resumePositionMs,
} from '../../core/progress/progress.ts'
import { itemTimeline, segmentsForVersion } from '../../core/segments/chapters.ts'
import type { PlaybackSettingsReader } from '../../core/settings/settings.ts'
import { keyframePriority, requestKeyframes } from './shared/keyframe-requests.ts'
import { memoryTargetOf } from './shared/memory-target.ts'

type Deps = {
  visibleItems: Pick<VisibleItems, 'findVisible'>
  playableSources: Pick<
    PlayableSources,
    'listReadySources' | 'listSourceItemIds' | 'listMediaSegments'
  >
  progressRepository: ProgressRepository
  sessionRepository: PlaybackSessionRepository
  subtitleTrackRepository: SubtitleTrackRepository
  trackPreferenceRepository: TrackPreferenceRepository
  profileTracks: (profileId: string) => ProfileTrackDefaults | undefined
  playbackSettings: PlaybackSettingsReader
  mediaProber: MediaProber
  keyframeStore: KeyframeStore
  jobQueue: JobQueue
  trickplayUrl?: (sourceId: string) => string | undefined
  streamSecrets: SessionTokens
  clock: Clock
  ids: IdGenerator
  logger: Logger
}

export type CreatePlaybackSessionError = AppError<
  | 'item/not_found'
  | 'item/invalid_kind'
  | 'item/no_playable_source'
  | 'playback/source_unavailable'
  | 'playback/mode_unsupported'
  | 'playback/subtitle_unsupported'
  | 'playback/transcode_limit_reached'
>

export type VersionChoice = { sourceId: string; version: SourceVersion; selected: boolean }

export type CreatedPlaybackSession = {
  streamSecret: string
  session: PlaybackSession
  plan: PlaybackPlan
  source: PlayableSource
  media: MediaInfo
  startPositionMs: number
  durationMs?: number
  mediaSegments: MediaSegment[]
  audioTracks: { stream: AudioStreamInfo; delivery?: AudioDelivery }[]
  subtitleTracks: SubtitleTrack[]
  tracks: ResolvedTracks
  burnInEnabled: boolean
  subtitlesInEngine: boolean
  availableQualities: PlaybackQuality[]
  versions: VersionChoice[]
  parts: TimelinePart[]
  partOffsetMs: number
  trickplayUrl?: string
  seekPointsMs?: number[]
}

type Input = {
  accountId: string
  authSessionId: string
  profileId: string
  itemId: string
  sourceId?: string
  capabilities: ClientCapabilities
  audioStreamIndex?: number
  subtitleTrackId?: string
  quality: PlaybackQuality
  startPositionMs?: number
  scope: VisibilityScope
}

type MediaResult = Result<MediaInfo, AppError<'playback/source_unavailable'>>

const unique = (values: readonly string[]): string[] => [...new Set(values)]

/** mpv plays the file as is at Original, anything else through `hls_transcode` (§10.2). */
const engineDirect = (media: MediaInfo, quality: PlaybackQuality): boolean => {
  const video = media.video[0]
  return video !== undefined && effectiveQuality(video, quality) === 'original'
}

/**
 * The engine never burns in: a resolved track it cannot get (a bitmap track of an HLS output,
 * or an external bitmap file) is left aside, named by the request or not (§10.4).
 */
const forEngine = (resolved: ResolvedTracks, mode: { direct: boolean }): ResolvedTracks => {
  const { subtitle, ...rest } = resolved
  return subtitle === undefined || engineSubtitleDelivery(subtitle, mode) === 'unsupported'
    ? { ...rest, burnIn: false }
    : { ...rest, subtitle, burnIn: false }
}

export const createPlaybackSessionFactory = ({
  visibleItems,
  playableSources,
  progressRepository,
  sessionRepository,
  subtitleTrackRepository,
  trackPreferenceRepository,
  profileTracks,
  playbackSettings,
  mediaProber,
  keyframeStore,
  jobQueue,
  trickplayUrl,
  streamSecrets,
  clock,
  ids,
  logger,
}: Deps) => {
  const trackContext = ({
    item,
    profileId,
    scope,
  }: {
    item: CatalogItem
    profileId: string
    scope: VisibilityScope
  }) => {
    const { ownerId, originalLanguage, genres } = memoryTargetOf(visibleItems, item, scope)
    const memory = trackPreferenceRepository.find({ profileId, itemId: ownerId })
    const profile = profileTracks(profileId)
    return {
      ...(memory === undefined ? {} : { memory }),
      ...(profile === undefined ? {} : { profile }),
      ...(originalLanguage === undefined ? {} : { originalLanguage }),
      genres,
    }
  }

  const explicitSubtitle = (
    trackId: string | undefined,
    tracks: readonly SubtitleTrack[],
  ): { subtitle?: 'off' | { trackId: string } } => {
    if (trackId === undefined) return {}
    if (trackId === 'off') return { subtitle: 'off' }
    if (tracks.some((track) => track.id === trackId)) return { subtitle: { trackId } }
    const elsewhere = subtitleTrackRepository.findById(trackId)
    const equivalent = elsewhere === undefined ? undefined : equivalentSubtitle(elsewhere, tracks)
    return equivalent === undefined ? {} : { subtitle: { trackId: equivalent.id } }
  }

  const chooseVersion = async ({
    versions,
    input,
    mediaOf,
  }: {
    versions: readonly [PlaybackVersion, ...PlaybackVersion[]]
    input: Input
    mediaOf: (source: PlayableSource) => Promise<MediaResult>
  }): Promise<Result<PlaybackVersion, CreatePlaybackSessionError>> => {
    if (input.sourceId !== undefined) {
      const named = versionOf(versions, input.sourceId)
      return named === undefined
        ? err(
            appError('playback/source_unavailable', 'source not ready for this item', {
              context: { itemId: input.itemId, sourceId: input.sourceId },
            }),
          )
        : ok(named)
    }
    let usable: PlaybackVersion | undefined
    let firstError: MediaResult | undefined
    for (const version of versions) {
      const media = await mediaOf(version.parts[0])
      if (!media.ok) {
        firstError ??= media
        continue
      }
      const plan = decidePlayback({
        media: media.value,
        extension: version.parts[0].extension,
        capabilities: input.capabilities,
        quality: 'original',
      })
      if (!plan.ok) continue
      if (plan.value.mode !== 'hls_transcode') return ok(version)
      usable ??= version
    }
    if (usable !== undefined) return ok(usable)
    if (firstError !== undefined && !firstError.ok) return firstError
    return ok(versions[0])
  }

  return async (
    input: Input,
  ): Promise<Result<CreatedPlaybackSession, CreatePlaybackSessionError>> => {
    const { itemId, profileId, scope, capabilities } = input
    const item = visibleItems.findVisible({ id: itemId, scope })
    if (item === undefined) {
      return err(appError('item/not_found', 'item not found', { context: { itemId } }))
    }
    if (!isPlayableKind(item.kind)) {
      return err(
        appError('item/invalid_kind', 'only movies and episodes are playable', {
          context: { itemId, kind: item.kind },
        }),
      )
    }

    const probed = new Map<string, MediaResult>()
    const mediaOf = async (source: PlayableSource): Promise<MediaResult> => {
      const known = probed.get(source.id)
      if (known !== undefined) return known
      const result = await loadMedia(source)
      probed.set(source.id, result)
      return result
    }
    const loadMedia = async (source: PlayableSource): Promise<MediaResult> => {
      if (!source.rootReachable) {
        return err(
          appError('playback/source_unavailable', 'library root unreachable', {
            context: { sourceId: source.id },
          }),
        )
      }
      if (source.media !== undefined && source.media.video.length > 0) return ok(source.media)
      const live = await mediaProber.probe(source.path)
      return live.ok
        ? ok(live.value)
        : err(
            appError('playback/source_unavailable', 'source cannot be probed', {
              context: { sourceId: source.id },
              cause: live.error,
            }),
          )
    }

    const versions = rankVersions(
      groupVersions(playableSources.listReadySources({ itemId, scope })),
    )
    const [best, ...others] = versions
    if (best === undefined) {
      return err(
        appError('item/no_playable_source', 'item has no ready source', { context: { itemId } }),
      )
    }

    const chosen = await chooseVersion({ versions: [best, ...others], input, mediaOf })
    if (!chosen.ok) return chosen
    const version = chosen.value

    const medias: MediaInfo[] = []
    for (const part of version.parts) {
      const media = await mediaOf(part)
      if (!media.ok) return media
      medias.push(media.value)
    }
    const timeline = partsTimeline(
      version.parts.map((part, index) => ({
        sourceId: part.id,
        durationMs: medias[index]?.durationMs ?? 0,
      })),
    )
    const total = totalDurationMs(timeline)
    const durationMs =
      total > 0
        ? total
        : item.runtimeMinutes === undefined
          ? undefined
          : item.runtimeMinutes * 60_000
    const progress = progressRepository.find({ profileId, itemId })
    const startPositionMs = Math.min(
      input.startPositionMs ?? resumePositionMs(progress),
      durationMs ?? Number.MAX_SAFE_INTEGER,
    )
    const part = partAt(timeline, startPositionMs)
    const source = version.parts[part.index] ?? version.parts[0]
    const media = medias[part.index] ?? medias[0]
    if (media === undefined) throw new Error('every part has its media')

    const settings = playbackSettings.read()
    const subtitleTracks = subtitleTrackRepository.listForSource(source.id)
    const subtitlesInEngine = capabilities.engine === 'mpv'
    const subtitleChoice = explicitSubtitle(input.subtitleTrackId, subtitleTracks)
    const resolved = resolveTracks({
      audio: media.audio,
      subtitles: subtitleTracks,
      ...trackContext({ item, profileId, scope }),
      burnInEnabled: settings.burnInEnabled || subtitlesInEngine,
      explicit: {
        ...(input.audioStreamIndex === undefined
          ? {}
          : { audioStreamIndex: input.audioStreamIndex }),
        ...subtitleChoice,
      },
    })
    if (!resolved.ok) return resolved
    const tracks = subtitlesInEngine
      ? forEngine(resolved.value, { direct: engineDirect(media, input.quality) })
      : resolved.value
    if (resolved.value.subtitle !== undefined && tracks.subtitle === undefined) {
      logger.info('bitmap subtitle left aside for the engine', {
        itemId,
        sourceId: source.id,
        subtitleTrackId: resolved.value.subtitle.id,
      })
    }

    const decideWith = (candidate: ResolvedTracks, audioStreamIndex: number | undefined) =>
      decidePlayback({
        media,
        extension: source.extension,
        capabilities,
        quality: input.quality,
        burnIn: candidate.burnIn,
        textSubtitle: candidate.subtitle !== undefined && !candidate.burnIn,
        ...(audioStreamIndex === undefined ? {} : { audioStreamIndex }),
      })

    const now = clock.now()
    const withinTranscodeLimit = (
      plan: PlaybackPlan,
    ): Result<PlaybackPlan, CreatePlaybackSessionError> => {
      if (plan.mode !== 'hls_transcode') return ok(plan)
      const active = sessionRepository
        .listActive()
        .filter((other) => other.mode === 'hls_transcode' && !isExpired(other, now))
      const replaced = active
        .filter((other) => other.authSessionId === input.authSessionId && other.itemId === itemId)
        .reduce<PlaybackSession | undefined>(
          (latest, other) =>
            latest === undefined || other.startedAt.getTime() > latest.startedAt.getTime()
              ? other
              : latest,
          undefined,
        )
      const running = active.filter((other) => other.id !== replaced?.id)
      return running.length >= settings.maxConcurrentTranscodes
        ? err(
            appError('playback/transcode_limit_reached', 'too many transcodes running', {
              context: { limit: settings.maxConcurrentTranscodes },
            }),
          )
        : ok(plan)
    }
    const planFor = (
      candidate: ResolvedTracks,
    ): Result<PlaybackPlan, CreatePlaybackSessionError> => {
      const decided = decideWith(candidate, candidate.audio?.index)
      return decided.ok ? withinTranscodeLimit(decided.value) : decided
    }

    const first = planFor(tracks)
    const dropSubtitle =
      !first.ok &&
      tracks.burnIn &&
      subtitleChoice.subtitle === undefined &&
      (first.error.code === 'playback/transcode_limit_reached' ||
        first.error.code === 'playback/mode_unsupported')
    const { subtitle: _bitmap, ...unsubtitled } = tracks
    const selectedTracks: ResolvedTracks = dropSubtitle ? { ...unsubtitled, burnIn: false } : tracks
    const planned = dropSubtitle ? planFor(selectedTracks) : first
    if (!planned.ok) return planned
    const plan = planned.value
    if (dropSubtitle) {
      logger.info('automatic bitmap subtitle left out', {
        itemId,
        sourceId: source.id,
        subtitleTrackId: tracks.subtitle?.id,
        reason: first.ok ? undefined : first.error.code,
      })
    }
    const decide = (audioStreamIndex: number | undefined) =>
      decideWith(selectedTracks, audioStreamIndex)

    if (plan.mode === 'hls_remux' && !isFreshIndex(keyframeStore.read(source.id), source)) {
      requestKeyframes(jobQueue, source.id, keyframePriority.interactive)
    }

    const audio = plan.mode === 'direct' ? plan.audio : plan.audio?.stream
    const subtitle = selectedTracks.subtitle
    const streamSecret = streamSecrets.generate()
    const session: PlaybackSession = {
      id: ids.next(),
      profileId,
      authSessionId: input.authSessionId,
      accountId: input.accountId,
      sourceId: source.id,
      itemId,
      mode: plan.mode,
      quality: plan.quality,
      ...(audio === undefined ? {} : { audioStream: audio.index }),
      ...(subtitle === undefined ? {} : { subtitleTrackId: subtitle.id }),
      burnIn: selectedTracks.burnIn,
      ...(plan.mode !== 'direct' && plan.audio !== undefined
        ? { audioDelivery: plan.audio.delivery }
        : {}),
      streamSecretHash: streamSecrets.hash(streamSecret),
      startedAt: now,
      lastHeartbeatAt: now,
      positionMs: startPositionMs,
    }
    const { accountId: _accountId, ...row } = session
    sessionRepository.insert(row)

    const segmentsOf = (id: string) =>
      segmentsForVersion(playableSources.listMediaSegments(id), {
        referenceMs: itemTimeline(
          playableSources.listReadySources({ itemId: id, scope: everything }),
        ).durationMs,
        playedMs: total > 0 ? total : undefined,
      })
    const mediaSegments = segmentsOf(itemId)

    for (const playedId of unique([itemId, ...playableSources.listSourceItemIds(source.id)])) {
      progressRepository.showAncestorsAgain({ profileId, itemId: playedId })
      if (durationMs === undefined || durationMs <= 0) continue
      const previous =
        playedId === itemId ? progress : progressRepository.find({ profileId, itemId: playedId })
      progressRepository.save(
        applyPosition(previous, {
          profileId,
          itemId: playedId,
          positionMs: startPositionMs,
          durationMs,
          at: now,
          ...creditsStartOf(playedId === itemId ? mediaSegments : segmentsOf(playedId)),
        }),
      )
    }
    logger.info('playback session started', {
      sessionId: session.id,
      itemId,
      sourceId: source.id,
      mode: plan.mode,
      quality: plan.quality,
      trackSelection: selectedTracks.origin,
      ...(plan.mode === 'hls_transcode' ? { reasons: plan.reasons } : {}),
      ...(plan.mode === 'hls_remux' ? { audio: plan.audio?.delivery } : {}),
    })

    return ok({
      streamSecret,
      session,
      plan,
      source,
      media,
      startPositionMs,
      ...(durationMs === undefined ? {} : { durationMs }),
      mediaSegments,
      audioTracks: media.audio.map((stream) => {
        const alternative = decide(stream.index)
        const delivery: AudioDelivery | undefined = !alternative.ok
          ? undefined
          : alternative.value.mode === 'direct'
            ? 'direct'
            : alternative.value.audio?.delivery
        return { stream, ...(delivery === undefined ? {} : { delivery }) }
      }),
      subtitleTracks,
      tracks: selectedTracks,
      burnInEnabled: settings.burnInEnabled,
      subtitlesInEngine,
      availableQualities: availableQualities(media.video[0]),
      versions: versions.map((candidate) => ({
        sourceId: candidate.parts[0].id,
        version: candidate.parts[0].version,
        selected: candidate.key === version.key,
      })),
      parts: timeline,
      partOffsetMs: part.offsetMs,
      ...withTrickplay(trickplayUrl?.(source.id)),
      ...withSeekPoints(
        plan.mode === 'hls_transcode' && !session.burnIn
          ? transcodeSeekPointsMs(keyframeStore, source, plan.video.durationMs ?? media.durationMs)
          : undefined,
      ),
    })
  }
}

const withTrickplay = (url: string | undefined) => (url === undefined ? {} : { trickplayUrl: url })

const transcodeSeekPointsMs = (
  keyframeStore: KeyframeStore,
  source: { id: string; sizeBytes: number; mtime: number },
  durationMs: number | undefined,
): number[] | undefined => {
  const index = keyframeStore.read(source.id)
  if (!isFreshIndex(index, source) || durationMs === undefined) return undefined
  return seekPointsOf(planTranscodeSegments(durationMs / 1000, index.keyframes)).map((startS) =>
    Math.round(startS * 1000),
  )
}

const withSeekPoints = (points: number[] | undefined) =>
  points === undefined ? {} : { seekPointsMs: points }

export type CreatePlaybackSession = ReturnType<typeof createPlaybackSessionFactory>
