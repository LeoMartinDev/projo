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

export const progressRules = {
  resumeFromRatio: 0.02,
  watchedAtRatio: 0.93,
  creditsFromRatio: 0.5,
} as const

const ratio = ({ positionMs, durationMs }: { positionMs: number; durationMs: number }): number =>
  durationMs <= 0 ? 0 : positionMs / durationMs

export const isResumable = (position: { positionMs: number; durationMs: number }): boolean => {
  const r = ratio(position)
  return r >= progressRules.resumeFromRatio && r < progressRules.watchedAtRatio
}

export const resumePositionMs = (progress: ItemProgress | undefined): number =>
  progress !== undefined && isResumable(progress) ? progress.positionMs : 0

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
  creditsStartMs?: number
}

const inCredits = (positionMs: number, durationMs: number, creditsStartMs?: number): boolean =>
  creditsStartMs !== undefined &&
  durationMs > 0 &&
  creditsStartMs >= durationMs * progressRules.creditsFromRatio &&
  positionMs >= creditsStartMs

export const applyPosition = (
  previous: ItemProgress | undefined,
  { profileId, itemId, positionMs, durationMs, at, creditsStartMs }: PositionInput,
): ItemProgress => {
  const clamped = durationMs > 0 ? Math.min(positionMs, durationMs) : positionMs
  const next = {
    positionMs: inCredits(clamped, durationMs, creditsStartMs) ? durationMs : clamped,
    durationMs,
  }
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

export const creditsStartOf = (
  segments: readonly { type: string; startMs: number }[],
): { creditsStartMs?: number } => {
  const credits = segments.find((segment) => segment.type === 'credits')
  return credits === undefined ? {} : { creditsStartMs: credits.startMs }
}

type MarkInput = { profileId: string; itemId: string; at: Date; durationMs?: number }

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

export type ProgressRepository = {
  find: (input: { profileId: string; itemId: string }) => ItemProgress | undefined
  findMany: (input: { profileId: string; itemIds: readonly string[] }) => Map<string, ItemProgress>
  save: (progress: ItemProgress) => void
  saveMany: (progress: readonly ItemProgress[]) => void
  showAncestorsAgain: (input: { profileId: string; itemId: string }) => void
}
