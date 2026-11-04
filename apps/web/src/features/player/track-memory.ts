import type {
  AudioTrackDto,
  PlaybackSessionDto,
  SubtitleTrackDto,
  TrackPreferencesBody,
} from '@projo/shared/api/playback'
import type { ProfileDto, UpdateProfileBody } from '@projo/shared/api/profiles'

import { normalizeLanguage } from './subtitles.ts'

export type TrackKind = 'audio' | 'subtitles'
export type MemoryScope = 'series' | 'movie'

const known = (language: string | undefined) =>
  language === undefined || language === '' || language === 'und' ? undefined : language

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

export const selectionOf = (
  session: SelectedTracks,
): { audio: AudioTrackDto | undefined; subtitle: SubtitleTrackDto | undefined } => ({
  audio: session.audioTracks.find((track) => track.index === session.selectedAudioStreamIndex),
  subtitle: session.subtitleTracks.find((track) => track.id === session.selectedSubtitleTrackId),
})

export const memoryAtOpen = (
  session: SelectedTracks & Pick<PlaybackSessionDto, 'trackSelection'>,
): TrackPreferencesBody | undefined =>
  session.trackSelection === 'memory' ? preferencesOf(selectionOf(session)) : undefined

export const serialTasks = () => {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task)
    tail = run.catch(() => undefined)
    return run
  }
}

export type UndoAction = { type: 'restore'; body: TrackPreferencesBody } | { type: 'delete' }

export const undoActionFor = (previous: TrackPreferencesBody | undefined): UndoAction =>
  previous === undefined ? { type: 'delete' } : { type: 'restore', body: previous }

const profileLanguage = (language: string | undefined) => {
  const base = language === undefined ? undefined : normalizeLanguage(language)
  return base !== undefined && /^[a-z]{2,3}$/.test(base) ? base : undefined
}

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

export type TrackToast = {
  id: number
  kind: TrackKind
  scope: MemoryScope
  previous: TrackPreferencesBody | undefined
  current: TrackPreferencesBody
  status: 'applied' | 'defaulting' | 'defaulted' | 'undone' | 'failed'
}

export const toastAutoHideMs = 8000
export const toastConfirmHideMs = 2500

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

export const toastHideDelay = (toast: TrackToast): number | undefined =>
  toast.status === 'applied' || toast.status === 'failed'
    ? toastAutoHideMs
    : toast.status === 'defaulting'
      ? undefined
      : toastConfirmHideMs
