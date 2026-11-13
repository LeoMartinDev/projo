import type { PlaybackSessionDto } from '@projo/shared/api/playback'

import type { EngineLoad } from '../core/engine.ts'

/**
 * The session and loads of the engine contract (`engine-contract.ts`), apart
 * from bun:test: a recorder running the contract's steps against a real engine
 * (the desktop app's libmpv) loads the same thing.
 */
export const contractSession: PlaybackSessionDto = {
  id: 'contract',
  itemId: 'item',
  sourceId: 'source',
  mode: 'direct',
  stream: { type: 'direct', url: '/api/v1/stream/contract/secret/file', mimeType: 'video/mp4' },
  startPositionMs: 0,
  heartbeatIntervalMs: 10_000,
  quality: 'original',
  availableQualities: ['original'],
  audioTracks: [],
  subtitleTracks: [],
  trackSelection: 'profile',
  burnIn: false,
  versions: [],
  parts: [],
  partOffsetMs: 0,
  chapters: [],
  segments: [],
}

// The stream the contract plays lasts this long by default.
export const contractDurationS = 60

export const contractLoad = (load: Partial<EngineLoad>): EngineLoad => ({
  session: contractSession,
  startSeconds: 0,
  autoplay: true,
  subtitleDelayMs: 0,
  ...load,
})
