import { appError, type AppError, err, ok, type Result } from '@projo/shared'
import type { ClientCapabilities, PlaybackQuality } from '@projo/shared/api/playback'

import {
  type CatalogItem,
  type CatalogRepository,
  everything,
  isPlayableKind,
  type MediaSegment,
  type PlayableSource,
  type VisibilityScope,
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
  type PlaybackPlan,
} from '../../core/playback/decide-mode.ts'
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
import type { SubtitleTrack, SubtitleTrackRepository } from '../../core/playback/subtitles.ts'
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
  type ProgressRepository,
  resumePositionMs,
} from '../../core/progress/progress.ts'
import { itemTimeline, segmentsForVersion } from '../../core/segments/chapters.ts'
import type { PlaybackSettingsReader } from '../../core/settings/settings.ts'
import { keyframePriority, requestKeyframes } from './index-keyframes.ts'
import { memoryTargetOf } from './track-preferences.ts'

type Deps = {
  catalogRepository: CatalogRepository
  progressRepository: ProgressRepository
  sessionRepository: PlaybackSessionRepository
  subtitleTrackRepository: SubtitleTrackRepository
  trackPreferenceRepository: TrackPreferenceRepository
  /** §11.1 settings of a profile; undefined for an unknown profile. */
  profileTracks: (profileId: string) => ProfileTrackDefaults | undefined
  playbackSettings: PlaybackSettingsReader
  mediaProber: MediaProber
  keyframeStore: KeyframeStore
  jobQueue: JobQueue
  /** §10.5: the trickplay sprites of a source are ready (written by the `trickplay` job). */
  trickplayReady?: (sourceId: string) => boolean
  /** §20: the secret of the session's stream URLs, stored hashed. */
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

/** §7.7: `version` tells it apart (labelled by the web). */
export type VersionChoice = { sourceId: string; version: SourceVersion; selected: boolean }

export type CreatedPlaybackSession = {
  /** §20: the capability secret of the stream URLs, returned once and never stored. */
  streamSecret: string
  session: PlaybackSession
  plan: PlaybackPlan
  /** The part played (the source itself when unstacked). */
  source: PlayableSource
  media: MediaInfo
  /** Item timeline (cumulative over the parts). */
  startPositionMs: number
  /** Item duration: the parts of the version added up. */
  durationMs?: number
  mediaSegments: MediaSegment[]
  /** Each audio track of the part, with how it would reach the browser if chosen. */
  audioTracks: { stream: AudioStreamInfo; delivery?: AudioDelivery }[]
  subtitleTracks: SubtitleTrack[]
  tracks: ResolvedTracks
  burnInEnabled: boolean
  availableQualities: PlaybackQuality[]
  /** Best first; `sourceId` = first part of each version. */
  versions: VersionChoice[]
  parts: TimelinePart[]
  partOffsetMs: number
  trickplayReady: boolean
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

/**
 * `POST /playback/sessions` (§10.6):
 * 1. the version (§7.7): the one of `sourceId` (any of its parts), else the best one playable
 *    without a video transcode on this client, else the highest resolution;
 * 2. the part (§8.4) that contains the start position (item timeline);
 * 3. the tracks: explicit ones, else the §11.2 cascade;
 * 4. the mode (§10.2), within `settings.max_concurrent_transcodes` for `hls_transcode`; a bitmap
 *    track chosen by the cascade (not named by the request) is left out when burning it in is
 *    impossible (no transcode slot, no HLS on the client): playable without subtitles;
 * 5. the session row, the progress of every item of the file (multi-episode files, §8.4), and the
 *    keyframe index right away when HLS remux needs it (§10.3).
 *
 * Transcode limit: active `hls_transcode` sessions count, except expired ones (no heartbeat for
 * 60 s, not swept yet) and the most recent one of the same auth session on the same item — the
 * player that replaces its session (quality, track, version change) is not blocked by the one it
 * is about to stop, whether it stops it before or after. Only one is exempt: other tabs of the
 * same browser on the same title count (at most one transcode above the limit, briefly). Ending
 * that session here instead would tell the player its current session was stopped before it
 * received the new one.
 */
export const createPlaybackSessionFactory = ({
  catalogRepository,
  progressRepository,
  sessionRepository,
  subtitleTrackRepository,
  trackPreferenceRepository,
  profileTracks,
  playbackSettings,
  mediaProber,
  keyframeStore,
  jobQueue,
  trickplayReady,
  streamSecrets,
  clock,
  ids,
  logger,
}: Deps) => {
  /**
   * The cascade's context: the series' (or movie's) memory, the profile, the work's original
   * language and genres (the anime rule).
   */
  const trackContext = ({
    item,
    profileId,
    scope,
  }: {
    item: CatalogItem
    profileId: string
    scope: VisibilityScope
  }) => {
    const { ownerId, originalLanguage, genres } = memoryTargetOf(catalogRepository, item, scope)
    const memory = trackPreferenceRepository.find({ profileId, itemId: ownerId })
    const profile = profileTracks(profileId)
    return {
      ...(memory === undefined ? {} : { memory }),
      ...(profile === undefined ? {} : { profile }),
      ...(originalLanguage === undefined ? {} : { originalLanguage }),
      genres,
    }
  }

  /**
   * `subtitleTrackId` of the request. A track of another source (the previous part, another
   * version) is mapped to its equivalent here; none, or an unknown id: the cascade decides.
   */
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

  /**
   * §7.7: the version of `sourceId`; else the best one (ranked) whose first part plays without a
   * video transcode on this client; else the best usable one; none usable: the first error.
   */
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
    // Every version decoded but none has a mode (no video stream, no HLS on the client).
    return ok(versions[0])
  }

  return async (
    input: Input,
  ): Promise<Result<CreatedPlaybackSession, CreatePlaybackSessionError>> => {
    const { itemId, profileId, scope, capabilities } = input
    const item = catalogRepository.findVisible({ id: itemId, scope })
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
      groupVersions(catalogRepository.listReadySources({ itemId, scope })),
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

    // Every part's media: the offsets need the durations of the parts before.
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
    const subtitleChoice = explicitSubtitle(input.subtitleTrackId, subtitleTracks)
    const tracks = resolveTracks({
      audio: media.audio,
      subtitles: subtitleTracks,
      ...trackContext({ item, profileId, scope }),
      burnInEnabled: settings.burnInEnabled,
      explicit: {
        ...(input.audioStreamIndex === undefined
          ? {}
          : { audioStreamIndex: input.audioStreamIndex }),
        ...subtitleChoice,
      },
    })
    if (!tracks.ok) return tracks

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

    // Synchronous from here: no other request can start a transcode between the count and the
    // insert.
    const now = clock.now()
    const withinTranscodeLimit = (
      plan: PlaybackPlan,
    ): Result<PlaybackPlan, CreatePlaybackSessionError> => {
      if (plan.mode !== 'hls_transcode') return ok(plan)
      const active = sessionRepository
        .listActive()
        .filter((other) => other.mode === 'hls_transcode' && !isExpired(other, now))
      // Only the latest one of this auth session on this item is the one being replaced: N tabs
      // of one browser on one title do not get N transcodes.
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

    // A bitmap track the cascade picked (not the request) must not make the file unplayable:
    // without a transcode slot, or HLS on the client, the session starts without subtitles.
    const first = planFor(tracks.value)
    const dropSubtitle =
      !first.ok &&
      tracks.value.burnIn &&
      subtitleChoice.subtitle === undefined &&
      (first.error.code === 'playback/transcode_limit_reached' ||
        first.error.code === 'playback/mode_unsupported')
    const { subtitle: _bitmap, ...unsubtitled } = tracks.value
    const selectedTracks: ResolvedTracks = dropSubtitle
      ? { ...unsubtitled, burnIn: false }
      : tracks.value
    const planned = dropSubtitle ? planFor(selectedTracks) : first
    if (!planned.ok) return planned
    const plan = planned.value
    if (dropSubtitle) {
      logger.info('automatic bitmap subtitle left out', {
        itemId,
        sourceId: source.id,
        subtitleTrackId: tracks.value.subtitle?.id,
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

    // A play starts: `last_played_at`, back in the home rows (its series too, §13.1), and the
    // duration recorded for the heartbeats. A multi-episode file plays every episode it holds.
    for (const playedId of unique([itemId, ...catalogRepository.listSourceItemIds(source.id)])) {
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
      mediaSegments: segmentsForVersion(catalogRepository.listMediaSegments(itemId), {
        referenceMs: itemTimeline(catalogRepository.listReadySources({ itemId, scope: everything }))
          .durationMs,
        playedMs: total > 0 ? total : undefined,
      }),
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
      availableQualities: availableQualities(media.video[0]),
      versions: versions.map((candidate) => ({
        sourceId: candidate.parts[0].id,
        version: candidate.parts[0].version,
        selected: candidate.key === version.key,
      })),
      parts: timeline,
      partOffsetMs: part.offsetMs,
      trickplayReady: trickplayReady?.(source.id) ?? false,
    })
  }
}

export type CreatePlaybackSession = ReturnType<typeof createPlaybackSessionFactory>
