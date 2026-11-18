import type { AppError, Result } from '@projo/shared'

export type TranscodeLimitReached = AppError<'playback/transcode_limit_reached'>

/** What holds a slot outside the playback sessions: a live channel's `compat` stream (§29.4). */
export type TranscodeSlotHolder = {
  /**
   * Orders the idle holders, lower = idle for longer; `undefined` while the holder is in use
   * (it then keeps its slot whatever else needs one).
   */
  idleOrder: () => number | undefined
  /** Stops the idle holder to free its slot: gives it back (`release`) before returning. */
  evict: () => void
}

/**
 * The slots of `max_concurrent_transcodes` (§10.3) held outside playback sessions: the `compat`
 * streams of live channels (§29.4). They share the limit with the playback sessions in
 * `hls_transcode`: each side counts the other's. An idle holder keeps its slot only until
 * something else needs it: idle holders are evicted first, the one idle the longest first.
 */
export type TranscodeSlots = {
  /**
   * Takes a slot for `id` (again: nothing more), evicting idle holders when the limit leaves
   * none free; refused when the playback transcodes and the holders in use fill the limit.
   */
  acquire: (id: string, holder: TranscodeSlotHolder) => Result<void, TranscodeLimitReached>
  /** Gives back the slot of `id`, if it holds one. */
  release: (id: string) => void
  /**
   * Room for one more playback transcode beside the `playing` ones (those the new session does
   * not replace), evicting idle holders when needed; refused as `acquire` is.
   */
  admitPlayback: (playing: number) => Result<void, TranscodeLimitReached>
}
