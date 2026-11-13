import type {
  CreatePlaybackSessionBody,
  PlaybackHeartbeatBody,
  PlaybackSessionDto,
  TrackPreferencesBody,
} from '@projo/shared/api/playback'
import type { UpdateProfileBody } from '@projo/shared/api/profiles'

import type { PlaybackApi } from '../application/ports.ts'
import type { PlayerFailure } from '../core/failure.ts'

export const sessionDto = (
  id: string,
  overrides: Partial<PlaybackSessionDto> = {},
): PlaybackSessionDto => ({
  id,
  itemId: 'item-1',
  sourceId: 'source-1',
  mode: 'hls_remux',
  stream: { type: 'hls', url: `/api/v1/stream/${id}/secret/master.m3u8` },
  startPositionMs: 0,
  heartbeatIntervalMs: 10_000,
  quality: 'original',
  availableQualities: ['original', '720p'],
  audioTracks: [],
  subtitleTracks: [],
  trackSelection: 'profile',
  burnIn: false,
  versions: [],
  parts: [],
  partOffsetMs: 0,
  chapters: [],
  segments: [],
  ...overrides,
})

type Answer = PlaybackSessionDto | { failure: PlayerFailure }

/**
 * A playback API in memory: every call is logged ('create', 'heartbeat s1
 * 12000', 'beacon …', 'end s1', 'put …', 'delete …', 'profile …'); session
 * creations are answered from `answers` (by default, `s1`, `s2`… with the
 * requested start position).
 */
export const createFakePlaybackApi = ({
  answer = (body, index) =>
    sessionDto(`s${index + 1}`, {
      itemId: body.itemId,
      startPositionMs: body.startPositionMs ?? 0,
      ...(body.sourceId === undefined ? {} : { sourceId: body.sourceId }),
      quality: body.quality ?? 'original',
    }),
}: {
  answer?: (body: CreatePlaybackSessionBody, index: number) => Answer
} = {}) => {
  const log: string[] = []
  const created: CreatePlaybackSessionBody[] = []
  const held: (() => void)[] = []
  let holding = false
  const position = (body: PlaybackHeartbeatBody) =>
    `${body.positionMs}${body.paused ? ' paused' : ''}`
  const api: PlaybackApi = {
    createSession: (body) => {
      log.push('create')
      const index = created.length
      created.push(body)
      const result = answer(body, index)
      const settle = () =>
        'failure' in result ? Promise.reject(result.failure) : Promise.resolve(result)
      if (!holding) return settle()
      return new Promise((resolve, reject) => held.push(() => void settle().then(resolve, reject)))
    },
    heartbeat: async (id, body) => void log.push(`heartbeat ${id} ${position(body)}`),
    beacon: (id, body) => void log.push(`beacon ${id} ${position(body)}`),
    endSession: async (id) => void log.push(`end ${id}`),
    putTrackPreferences: async (itemId, body: TrackPreferencesBody) =>
      void log.push(`put ${itemId} ${JSON.stringify(body)}`),
    deleteTrackPreferences: async (itemId) => void log.push(`delete ${itemId}`),
    updateProfile: async (profileId, body: UpdateProfileBody) =>
      void log.push(`profile ${profileId} ${JSON.stringify(body)}`),
  }
  return {
    api,
    log,
    created,
    // Session creations wait for `release` while held.
    hold: () => {
      holding = true
    },
    release: () => {
      holding = false
      for (const run of held.splice(0)) run()
    },
  }
}

export type FakePlaybackApi = ReturnType<typeof createFakePlaybackApi>
