import type { AppError, Result } from '@projo/shared'

import type { TvUpstream } from './channel.ts'
import type { LiveTransport } from './live.ts'

/** A snapshot not taken (§29.4): internal, logged; `context.reason` says why. */
export type TvSnapshotError = AppError<'tv/snapshot_unavailable'>

/**
 * Why a background grab failed (§29.4): `refused` (an HTTP 403, 429 or another 4xx than 400,
 * 401 and 404, an RTSP 453), `timeout` (killed at 12 s, a socket timeout), `failed` (anything
 * else). The first two are the source's refusals.
 */
export const tvGrabFailureReasons = ['refused', 'timeout', 'failed'] as const
export type TvGrabFailureReason = (typeof tvGrabFailureReasons)[number]

/** A snapshot's file, relative to the images directory (§29.4). */
export const tvSnapshotPathOf = (channelId: string): string => `tv/snapshots/${channelId}.webp`

/** A snapshot is refused past this size: a 480 px WebP weighs a few tens of KB. */
export const TV_SNAPSHOT_MAX_BYTES = 2 * 1024 * 1024

/** ffmpeg making a snapshot is killed past this long (§29.4). */
export const TV_SNAPSHOT_TIMEOUT_MS = 12_000

/** The ffmpeg runs that make snapshots (§29.4), each a WebP picture in memory. */
export type TvSnapshotter = {
  /**
   * A picture from a running `copy` stream's run `run`: its init then `segment`, files of the
   * stream's folder, fed on ffmpeg's stdin (no provider connection). Aborting `signal` kills it.
   */
  fromRun: (input: {
    channelId: string
    run: number
    segment: string
    interlaced: boolean
    signal: AbortSignal
  }) => Promise<Result<Uint8Array, TvSnapshotError>>
  /**
   * A picture read from the upstream (a background grab): one keyframe. Settles once ffmpeg is
   * gone, also when `signal` aborts (the grab is evicted). Its error's `context.reason` is a
   * `TvGrabFailureReason`; nothing in it holds a URL or a secret.
   */
  grab: (input: {
    upstream: TvUpstream
    transport?: LiveTransport
    interlaced: boolean
    signal: AbortSignal
  }) => Promise<Result<Uint8Array, TvSnapshotError>>
}

/** A source as the background grabs see it (§29.4), its setting's default applied. */
export type TvSnapshotSource = {
  id: string
  maxConnections?: number
  snapshots: boolean
  grabsPerHour: number
}

/** An enabled, present channel a background grab may pick (§29.4). */
export type TvSnapshotCandidate = {
  id: string
  snapshotAt?: Date
  /** The last background grab, and the consecutive failed ones. */
  attemptAt?: Date
  failures: number
  watchedAt?: Date
}

/** The snapshots' columns of channels and sources (§29.4). */
export type TvSnapshotRepository = {
  /** Every source, its snapshot setting's default applied. */
  sources: () => TvSnapshotSource[]
  /** The source's enabled, present channels, in the page's order (group, then channel). */
  candidatesOf: (sourceId: string) => TvSnapshotCandidate[]
  /** The channels any profile has among its favourites. */
  favoriteChannelIds: () => ReadonlySet<string>
  snapshotAtOf: (channelId: string) => Date | undefined
  /**
   * Records a snapshot taken at `at` (a grab's also resets its failures); `false` when the
   * channel is gone meanwhile.
   */
  recordSnapshot: (input: { id: string; at: Date; grabbed: boolean }) => boolean
  /** Records a failed background grab: its time, one more consecutive failure. */
  recordGrabFailure: (input: { id: string; at: Date }) => void
  /** A live session opened the channel at `at`. */
  recordWatched: (input: { id: string; at: Date }) => void
  /** The enabled, present channels whose snapshot was taken at `since` or later. */
  freshSnapshots: (since: Date) => ReadonlyMap<string, Date>
  /** Snapshot files of the source's channels (to delete with it). */
  snapshotPathsOf: (sourceId: string) => string[]
}
