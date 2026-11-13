import type {
  MediaSegmentDto,
  PlaybackPartDto,
  PlaybackSessionDto,
  TrackPreferencesBody,
} from '@projo/shared/api/playback'
import type { ProfileDto } from '@projo/shared/api/profiles'

import type { PlayerFailure } from '../core/failure.ts'
import type { MediaState } from '../core/media-state.ts'
import {
  type Countdown,
  countdownFor,
  countdownRuns,
  countdownStartMs,
  nextUpLaunches,
  type NextUpTrigger,
  nextUpTriggerAt,
  type NextUpView,
  nextUpViewFor,
} from '../core/next-up.ts'
import {
  segmentKey,
  skipButtonPhase,
  type SkippableSegment,
  skippableAt,
} from '../core/segment-skip.ts'
import { reconnectDelay, type SessionRequest } from '../core/session-request.ts'
import { itemPositionMs, nextPart, totalDurationMs } from '../core/timeline.ts'
import type { MemoryScope, TrackToast } from '../core/track-memory.ts'

export type Interruption =
  | { kind: 'failure'; failure: PlayerFailure }
  | { kind: 'network'; failure: PlayerFailure }
  | { kind: 'terminated'; reason: 'admin' | 'timeout' | 'ended' }

export type SubtitleDelivery = 'overlay' | 'hls' | 'engine'

// What the controller holds; `undefined` values are explicit (they are reset).
export type PlayerState = {
  request: SessionRequest
  // The session of `request`: being created, failed or there.
  creation: 'pending' | 'error' | 'ready'
  createFailure: PlayerFailure | undefined
  session: PlaybackSessionDto | undefined
  // Who draws the session's subtitles (from the capabilities it was created with).
  subtitles: SubtitleDelivery
  interruption: Interruption | undefined
  reconnectAttempt: number
  // Between a session and the next one (track, quality, version, part, retry).
  switching: { positionMs: number; totalMs: number } | undefined
  audioChoice: { sessionId: string; index: number } | undefined
  subtitleChoice: { sessionId: string; id: string | undefined } | undefined
  lastSubtitleId: string | undefined
  subtitlesChosen: boolean
  rate: number
  toast: TrackToast | undefined
  memory: { value: TrackPreferencesBody | undefined } | undefined
  skipEntry: { key: string; atMs: number } | undefined
  skipped: { segment: SkippableSegment; id: number } | undefined
  creditsDismissed: boolean
  countdown: Countdown | undefined
}

// What the controller needs from the page around it (item, profile, next episode).
export type PlayerContext = {
  itemDurationMs: number | undefined
  scope: MemoryScope
  profile:
    | Pick<
        ProfileDto,
        | 'id'
        | 'subtitleMode'
        | 'subtitleLanguage'
        | 'autoSkipIntro'
        | 'autoplayNext'
        | 'autoSkipCredits'
      >
    | undefined
  next: 'loading' | 'none' | 'found'
}

export const initialPlayerContext: PlayerContext = {
  itemDurationMs: undefined,
  scope: 'movie',
  profile: undefined,
  next: 'loading',
}

export type PlayerView = {
  session: PlaybackSessionDto | undefined
  streamMs: number
  positionMs: number
  totalMs: number
  bufferedMs: number
  followingPart: PlaybackPartDto | undefined
  audioIndex: number | undefined
  subtitleId: string | undefined
  failure: PlayerFailure | undefined
  networkLost: boolean
  blocked: boolean
  loading: boolean
  itemEnded: boolean
  segments: readonly MediaSegmentDto[]
  skippable: SkippableSegment | undefined
  skipView: { phase: 'full' | 'icon'; progress: number }
  trigger: NextUpTrigger | undefined
  nextUpView: NextUpView
  countdownStart: number | undefined
  countdown: Countdown | undefined
  counting: boolean
  launch: boolean
}

/** Everything the player shows, derived from the controller, the media and the page. */
export const playerView = (
  state: PlayerState,
  media: MediaState,
  context: PlayerContext,
): PlayerView => {
  const { session, switching, interruption } = state
  const streamMs = media.duration * 1000
  const totalMs =
    session === undefined
      ? (switching?.totalMs ?? context.itemDurationMs ?? 0)
      : totalDurationMs(session, streamMs)
  const positionMs =
    session === undefined
      ? (switching?.positionMs ?? 0)
      : itemPositionMs(session, media.currentTime)
  const bufferedMs = session === undefined ? 0 : itemPositionMs(session, media.bufferedEnd)
  const followingPart = session === undefined ? undefined : nextPart(session)
  const audioIndex =
    session === undefined
      ? undefined
      : state.audioChoice?.sessionId === session.id
        ? state.audioChoice.index
        : session.selectedAudioStreamIndex
  const subtitleId =
    session === undefined
      ? undefined
      : state.subtitleChoice?.sessionId === session.id
        ? state.subtitleChoice.id
        : session.selectedSubtitleTrackId

  const failure =
    interruption?.kind === 'failure' || interruption?.kind === 'network'
      ? interruption.failure
      : state.creation === 'error'
        ? state.createFailure
        : undefined
  const networkLost =
    failure !== undefined &&
    (interruption?.kind === 'network' || failure.code === 'network') &&
    reconnectDelay(state.reconnectAttempt) !== undefined
  const blocked = (failure !== undefined && !networkLost) || interruption?.kind === 'terminated'
  const loading =
    !blocked &&
    (networkLost ||
      state.creation === 'pending' ||
      (switching !== undefined && session === undefined) ||
      (media.waiting && !media.paused) ||
      !media.ready)

  const itemEnded = media.ended && followingPart === undefined && session !== undefined
  const segments = session?.segments ?? []
  const skippable = session === undefined ? undefined : skippableAt(segments, positionMs)
  const skipView =
    skippable !== undefined &&
    state.skipEntry !== undefined &&
    state.skipEntry.key === segmentKey(skippable)
      ? skipButtonPhase(state.skipEntry.atMs, positionMs)
      : { phase: 'full' as const, progress: 0 }

  const trigger =
    session === undefined
      ? undefined
      : nextUpTriggerAt({ segments, positionMs, totalMs, ended: itemEnded })
  const nextUpView = nextUpViewFor({
    trigger,
    creditsDismissed: state.creditsDismissed,
    next: context.next,
    blocked,
  })
  const countdownStart = countdownStartMs({
    autoplayNext: context.profile?.autoplayNext ?? true,
    autoSkipCredits: context.profile?.autoSkipCredits ?? false,
  })
  const countdown =
    nextUpView !== 'none' && trigger !== undefined
      ? countdownFor(state.countdown, trigger, countdownStart)
      : undefined
  return {
    session,
    streamMs,
    positionMs,
    totalMs,
    bufferedMs,
    followingPart,
    audioIndex,
    subtitleId,
    failure,
    networkLost,
    blocked,
    loading,
    itemEnded,
    segments,
    skippable,
    skipView,
    trigger,
    nextUpView,
    countdownStart,
    countdown,
    counting: countdownRuns({
      view: nextUpView,
      countdown,
      paused: media.paused,
      ended: itemEnded,
    }),
    launch: nextUpLaunches(nextUpView, countdown),
  }
}
