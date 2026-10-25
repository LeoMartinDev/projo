/**
 * Progress of a profile on a movie or an episode (§6.4 `playback_progress`) and the §13.1 rules.
 * Seasons and series have no stored progress: `aggregateWatchStatus` derives it from episodes.
 */

export type ItemProgress = {
  profileId: string
  itemId: string
  positionMs: number
  durationMs: number
  watched: boolean
  watchedAt?: Date
  playCount: number
  lastPlayedAt: Date
  hiddenFromContinue: boolean
}

export type ProgressState = 'unwatched' | 'in_progress' | 'watched'

/** §13.1 / §24: "Reprendre" between 2 % and 93 %, "vu" from 93 % or the start of `credits`. */
export const progressRules = {
  resumeFromRatio: 0.02,
  watchedAtRatio: 0.93,
  /**
   * A `credits` segment starting before half the duration is not trusted for "vu" (a wrong
   * marker would mark the item watched minutes in); the 93 % rule still applies.
   */
  creditsFromRatio: 0.5,
} as const

const ratio = ({ positionMs, durationMs }: { positionMs: number; durationMs: number }): number =>
  durationMs <= 0 ? 0 : positionMs / durationMs

/** True when the position lies in the "Reprendre" window. */
export const isResumable = (position: { positionMs: number; durationMs: number }): boolean => {
  const r = ratio(position)
  return r >= progressRules.resumeFromRatio && r < progressRules.watchedAtRatio
}

/** Where playback starts: the position inside the window, 0 otherwise (a watched item starts over). */
export const resumePositionMs = (progress: ItemProgress | undefined): number =>
  progress !== undefined && isResumable(progress) ? progress.positionMs : 0

/**
 * `in_progress` wins over `watched`: a watched item being rewatched shows where it stands.
 * Without a row, the item is unwatched.
 */
export const progressState = (progress: ItemProgress | undefined): ProgressState => {
  if (progress === undefined) return 'unwatched'
  if (isResumable(progress)) return 'in_progress'
  return progress.watched ? 'watched' : 'unwatched'
}

type PositionInput = {
  profileId: string
  itemId: string
  positionMs: number
  durationMs: number
  at: Date
  /** Start of the item's `credits` segment (§12.4), on the item timeline. */
  creditsStartMs?: number
}

/** True when the credits have started at `positionMs` (a trusted `credits` segment, §12.4). */
const inCredits = (positionMs: number, durationMs: number, creditsStartMs?: number): boolean =>
  creditsStartMs !== undefined &&
  durationMs > 0 &&
  creditsStartMs >= durationMs * progressRules.creditsFromRatio &&
  positionMs >= creditsStartMs

/**
 * A heartbeat or `PUT /progress`: stores the position; crossing 93 %, or entering the `credits`
 * segment, whichever comes first, marks the item watched and increments `play_count` (once per
 * crossing: staying above does not count again, coming back below then crossing again — a
 * rewatch — does). A position in the credits is stored as the end of the item, so it leaves
 * "Continue watching" and starts over at 0 like any watched item; seeking back before the
 * credits is a position like any other. A new play brings the item back in "Continuer".
 */
export const applyPosition = (
  previous: ItemProgress | undefined,
  { profileId, itemId, positionMs, durationMs, at, creditsStartMs }: PositionInput,
): ItemProgress => {
  const clamped = durationMs > 0 ? Math.min(positionMs, durationMs) : positionMs
  const next = {
    positionMs: inCredits(clamped, durationMs, creditsStartMs) ? durationMs : clamped,
    durationMs,
  }
  // The stored position says it all: a position in the credits was stored as the end.
  const wasAbove =
    previous !== undefined &&
    ratio({ positionMs: previous.positionMs, durationMs }) >= progressRules.watchedAtRatio
  const crossed = !wasAbove && durationMs > 0 && ratio(next) >= progressRules.watchedAtRatio
  return {
    profileId,
    itemId,
    ...next,
    watched: crossed || (previous?.watched ?? false),
    ...(crossed
      ? { watchedAt: at }
      : previous?.watchedAt === undefined
        ? {}
        : { watchedAt: previous.watchedAt }),
    playCount: (previous?.playCount ?? 0) + (crossed ? 1 : 0),
    lastPlayedAt: at,
    hiddenFromContinue: false,
  }
}

/** `creditsStartMs` of `applyPosition`: the start of the item's `credits` segment, if known. */
export const creditsStartOf = (
  segments: readonly { type: string; startMs: number }[],
): { creditsStartMs?: number } => {
  const credits = segments.find((segment) => segment.type === 'credits')
  return credits === undefined ? {} : { creditsStartMs: credits.startMs }
}

type MarkInput = { profileId: string; itemId: string; at: Date; durationMs?: number }

/**
 * Manual "Marquer comme vu": watched, `play_count` + 1, position back to 0 so the item leaves
 * "Continue watching". Already watched and not in progress: unchanged (idempotent).
 */
export const markWatched = (
  previous: ItemProgress | undefined,
  { profileId, itemId, at, durationMs }: MarkInput,
): ItemProgress => {
  if (previous !== undefined && previous.watched && !isResumable(previous)) return previous
  return {
    profileId,
    itemId,
    positionMs: 0,
    durationMs: previous?.durationMs ?? durationMs ?? 0,
    watched: true,
    watchedAt: at,
    playCount: (previous?.playCount ?? 0) + 1,
    lastPlayedAt: previous?.lastPlayedAt ?? at,
    hiddenFromContinue: previous?.hiddenFromContinue ?? false,
  }
}

/** Manual "non vu": not watched and position back to 0 (§13.1). `play_count` is history: kept. */
export const markUnwatched = (previous: ItemProgress): ItemProgress => {
  const { watchedAt: _dropped, ...rest } = previous
  return { ...rest, watched: false, positionMs: 0 }
}

export type WatchStatus = {
  state: 'unwatched' | 'partial' | 'watched'
  watchedCount: number
  inProgressCount: number
  totalCount: number
}

/**
 * A season or a series from its visible episodes: `watched` when every one is watched,
 * `partial` when at least one is watched or in progress.
 */
export const aggregateWatchStatus = (
  episodes: readonly (ItemProgress | undefined)[],
): WatchStatus => {
  const states = episodes.map(progressState)
  const inProgressCount = states.filter((state) => state === 'in_progress').length
  const watchedCount = episodes.filter((progress) => progress?.watched === true).length
  const totalCount = episodes.length
  const state =
    totalCount > 0 && watchedCount === totalCount && inProgressCount === 0
      ? 'watched'
      : watchedCount > 0 || inProgressCount > 0
        ? 'partial'
        : 'unwatched'
  return { state, watchedCount, inProgressCount, totalCount }
}

/** Persistence of `playback_progress`. Synchronous (bun:sqlite). */
export type ProgressRepository = {
  find: (input: { profileId: string; itemId: string }) => ItemProgress | undefined
  findMany: (input: { profileId: string; itemIds: readonly string[] }) => Map<string, ItemProgress>
  /** Upsert on (profile, item). */
  save: (progress: ItemProgress) => void
  saveMany: (progress: readonly ItemProgress[]) => void
  /**
   * A new play of an item brings its series back in the home rows (§13.1): clears
   * `hidden_from_continue` on the rows of the item's ancestors (season, series).
   */
  showAncestorsAgain: (input: { profileId: string; itemId: string }) => void
}
