import type { CreateTvSessionBody, TvSessionDto } from '@projo/shared/api/tv'

import type { LiveTvApi } from '../application/ports.ts'
import type { PlayerFailure } from '../core/failure.ts'

export const liveSessionDto = (sessionId: string): TvSessionDto => ({
  sessionId,
  streamUrl: `/api/v1/stream/${sessionId}/secret/live/index.m3u8`,
  rendition: 'copy',
})

type Answer = TvSessionDto | { failure: PlayerFailure }

/**
 * The live TV API in memory: every call is logged ('create c1', 'heartbeat l1', 'end l1');
 * creations are answered by `answer` (by default `l1`, `l2`…), heartbeats by `beat`.
 */
export const createFakeLiveApi = ({
  answer = (_channelId, index) => liveSessionDto(`l${index + 1}`),
}: {
  answer?: (channelId: string, index: number) => Answer
} = {}) => {
  const log: string[] = []
  const created: { channelId: string; body: CreateTvSessionBody }[] = []
  const held: (() => void)[] = []
  let holding = false
  let beat: (sessionId: string) => PlayerFailure | undefined = () => undefined
  const api: LiveTvApi = {
    createSession: (channelId, body) => {
      log.push(`create ${channelId}`)
      const index = created.length
      created.push({ channelId, body })
      const result = answer(channelId, index)
      const settle = () =>
        'failure' in result ? Promise.reject(result.failure) : Promise.resolve(result)
      if (!holding) return settle()
      return new Promise((resolve, reject) => held.push(() => void settle().then(resolve, reject)))
    },
    heartbeat: (sessionId) => {
      log.push(`heartbeat ${sessionId}`)
      const failure = beat(sessionId)
      return failure === undefined ? Promise.resolve() : Promise.reject(failure)
    },
    endSession: async (sessionId) => void log.push(`end ${sessionId}`),
  }
  return {
    api,
    log,
    created,
    // Heartbeats are answered by `answer` from now on (a failure rejects them).
    beats: (answer: (sessionId: string) => PlayerFailure | undefined) => {
      beat = answer
    },
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

export type FakeLiveApi = ReturnType<typeof createFakeLiveApi>
