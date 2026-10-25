import type {
  AudioTrackDto,
  PlaybackSessionDto,
  SubtitleTrackDto,
  TrackPreferencesBody,
} from '@projo/shared/api/playback'
import type { ProfileDto, UpdateProfileBody } from '@projo/shared/api/profiles'

import { normalizeLanguage } from './subtitles.ts'

/**
 * Manual track change during playback (§11.3): the choice is remembered for the series (or the
 * movie) with `PUT /items/:id/track-preferences`; a toast says so and offers "Set as
 * default for my profile" (`PATCH /profiles/:id`) and "Undo" (the previous memory back, or
 * `DELETE` when there was none). The profile defaults never change without that action. Pure.
 */

export type TrackKind = 'audio' | 'subtitles'
export type MemoryScope = 'series' | 'movie'

const known = (language: string | undefined) =>
  language === undefined || language === '' || language === 'und' ? undefined : language

/** The memory matching a selection: languages of the chosen tracks, subtitles on or off. */
export const preferencesOf = ({
  audio,
  subtitle,
}: {
  audio: AudioTrackDto | undefined
  subtitle: SubtitleTrackDto | undefined
}): TrackPreferencesBody => {
  const audioLanguage = known(audio?.language)
  const subtitleLanguage = known(subtitle?.language)
  return {
    ...(audioLanguage === undefined ? {} : { audioLanguage }),
    ...(subtitleLanguage === undefined ? {} : { subtitleLanguage }),
    subtitlesEnabled: subtitle !== undefined,
  }
}

type SelectedTracks = Pick<
  PlaybackSessionDto,
  'audioTracks' | 'selectedAudioStreamIndex' | 'subtitleTracks' | 'selectedSubtitleTrackId'
>

/** The tracks a session resolved (an audio change left to the cascade is remembered so). */
export const selectionOf = (
  session: SelectedTracks,
): { audio: AudioTrackDto | undefined; subtitle: SubtitleTrackDto | undefined } => ({
  audio: session.audioTracks.find((track) => track.index === session.selectedAudioStreamIndex),
  subtitle: session.subtitleTracks.find((track) => track.id === session.selectedSubtitleTrackId),
})

/**
 * The memory in force when the session opened, as far as the player can tell: the selected
 * tracks when the server says they came from it (`trackSelection = memory`), none otherwise.
 */
export const memoryAtOpen = (
  session: SelectedTracks & Pick<PlaybackSessionDto, 'trackSelection'>,
): TrackPreferencesBody | undefined =>
  session.trackSelection === 'memory' ? preferencesOf(selectionOf(session)) : undefined

/**
 * Runs the memory writes one after the other (`PUT`, then "Undo"'s `PUT` or `DELETE`), so
 * the last one asked is the last one the server applies. A failure does not block the next.
 */
export const serialTasks = () => {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task)
    tail = run.catch(() => undefined)
    return run
  }
}

/** What "Undo" does: put the previous memory back, or remove the one just written. */
export type UndoAction = { type: 'restore'; body: TrackPreferencesBody } | { type: 'delete' }

export const undoActionFor = (previous: TrackPreferencesBody | undefined): UndoAction =>
  previous === undefined ? { type: 'delete' } : { type: 'restore', body: previous }

/** The profile takes a base code (`fr`, not `fr-FR` nor `fre`): 639-1 when known, else as is. */
const profileLanguage = (language: string | undefined) => {
  const base = language === undefined ? undefined : normalizeLanguage(language)
  return base !== undefined && /^[a-z]{2,3}$/.test(base) ? base : undefined
}

/**
 * "Set as default for my profile": the profile setting of the changed type. Audio: the
 * language. Subtitles turned on: their language, and `always` if the profile never wanted any;
 * turned off: `never`. `undefined` when there is nothing to set (track without language).
 */
export const profileDefaultsFor = (
  kind: TrackKind,
  memory: TrackPreferencesBody,
  profile: Pick<ProfileDto, 'subtitleMode'>,
): UpdateProfileBody | undefined => {
  if (kind === 'audio') {
    const audioLanguage = profileLanguage(memory.audioLanguage)
    return audioLanguage === undefined ? undefined : { audioLanguage }
  }
  if (!memory.subtitlesEnabled) return { subtitleMode: 'never' }
  const subtitleLanguage = profileLanguage(memory.subtitleLanguage)
  if (subtitleLanguage === undefined) return undefined
  return {
    subtitleLanguage,
    ...(profile.subtitleMode === 'never' ? { subtitleMode: 'always' as const } : {}),
  }
}

// ── Toast ────────────────────────────────────────────────────────────────────

export type TrackToast = {
  /** Distinguishes two toasts in a row (restarts the timer). */
  id: number
  kind: TrackKind
  scope: MemoryScope
  /** Memory before the change (`undefined`: none). */
  previous: TrackPreferencesBody | undefined
  current: TrackPreferencesBody
  status: 'applied' | 'defaulting' | 'defaulted' | 'undone' | 'failed'
}

export const toastAutoHideMs = 8000
export const toastConfirmHideMs = 2500

/**
 * A new manual change. A change made while the previous toast is still up keeps the memory that
 * was in force before the first one, so "Undo" undoes the whole burst.
 */
export const toastForChange = ({
  previousToast,
  memory,
  kind,
  scope,
  current,
}: {
  previousToast: TrackToast | undefined
  memory: TrackPreferencesBody | undefined
  kind: TrackKind
  scope: MemoryScope
  current: TrackPreferencesBody
}): TrackToast => ({
  id: (previousToast?.id ?? 0) + 1,
  kind,
  scope,
  previous: previousToast?.status === 'applied' ? previousToast.previous : memory,
  current,
  status: 'applied',
})

/** How long the toast stays in this state (`undefined` while a request is running). */
export const toastHideDelay = (toast: TrackToast): number | undefined =>
  toast.status === 'applied' || toast.status === 'failed'
    ? toastAutoHideMs
    : toast.status === 'defaulting'
      ? undefined
      : toastConfirmHideMs
