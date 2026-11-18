/**
 * Timeshift in the `<video>` (§29.5): wall-clock times of the replay window mapped to media
 * times, for hls.js (its fragments' program dates) and native HLS (`getStartDate()`). Pure.
 */

/** A fragment of hls.js's live playlist: its media start and duration (s), its program date. */
export type DatedFragment = { start: number; duration: number; dateMs: number | undefined }

/** The live point: this far before the end of what can be played (`liveSyncDuration`). */
export const liveSyncS = 6

/**
 * The media time of wall-clock `atMs`: in the fragment holding it, else at the start of the
 * first fragment after it (a restart's gap); undefined when no fragment is dated.
 */
export const mediaTimeAt = (
  fragments: readonly DatedFragment[],
  atMs: number,
): number | undefined => {
  const dated = fragments.filter(
    (fragment): fragment is DatedFragment & { dateMs: number } => fragment.dateMs !== undefined,
  )
  const holding = dated.find((fragment) => atMs < fragment.dateMs + fragment.duration * 1000)
  if (holding === undefined) {
    const last = dated.at(-1)
    return last === undefined ? undefined : last.start + last.duration
  }
  return holding.start + Math.max(0, atMs - holding.dateMs) / 1000
}

/** Native HLS: the media time of `atMs` from the stream's start date, within `seekable`. */
export const nativeMediaTimeAt = (
  startDateMs: number,
  atMs: number,
  seekable: { start: number; end: number },
): number => Math.min(Math.max((atMs - startDateMs) / 1000, seekable.start), seekable.end)

/** The end of what can be played minus the live sync: where "live" plays. */
export const livePointOf = (seekableEnd: number): number => Math.max(0, seekableEnd - liveSyncS)
