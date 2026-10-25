import type { PlaybackMode, PlaybackQuality } from '@projo/shared/api/playback'

import type { SourceVersion } from '../media/version.ts'

/** An active playback session as the admin sees it (§10.6, §15 "Active sessions"). */
export type ActivePlaybackSessionView = {
  id: string
  account: { id: string; name: string }
  profile: { id: string; name: string; color: string }
  item: {
    id: string
    kind: 'movie' | 'episode'
    /** Absent: an episode without a name of its own (§6.3). */
    title?: string
    seriesTitle?: string
    seasonNumber?: number
    episodeNumber?: number
  }
  mode: PlaybackMode
  quality?: PlaybackQuality
  burnIn: boolean
  /** Of the played source (§7.7). */
  version: SourceVersion
  positionMs: number
  durationMs?: number
  /** Device name of the auth session ("Firefox · macOS", or a bearer token's device). */
  device?: string
  startedAt: Date
  lastHeartbeatAt: Date
}

export type AdminPlaybackSessionQueries = {
  /** Sessions not ended, newest first. */
  listActive: () => ActivePlaybackSessionView[]
}
