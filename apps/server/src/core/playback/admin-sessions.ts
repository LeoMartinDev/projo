import type { PlaybackMode, PlaybackQuality } from '@projo/shared/api/playback'

import type { SourceVersion } from '../media/version.ts'

export type ActivePlaybackSessionView = {
  id: string
  account: { id: string; name: string }
  profile: { id: string; name: string; color: string }
  item: {
    id: string
    kind: 'movie' | 'episode'
    title?: string
    seriesTitle?: string
    seasonNumber?: number
    episodeNumber?: number
  }
  mode: PlaybackMode
  quality?: PlaybackQuality
  burnIn: boolean
  version: SourceVersion
  positionMs: number
  durationMs?: number
  device?: string
  startedAt: Date
  lastHeartbeatAt: Date
}

export type AdminPlaybackSessionQueries = {
  listActive: () => ActivePlaybackSessionView[]
}
