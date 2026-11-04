import { appError, type AppError, err, ok, type Result } from '@projo/shared'
import type { TrackSelectionOrigin } from '@projo/shared/api/playback'
import type { SubtitleMode } from '@projo/shared/api/profiles'

import { isAnime } from '../metadata/anime.ts'
import { normalizeLanguage } from '../naming/index.ts'
import type { AudioStreamInfo } from './media-info.ts'
import { isBitmapSubtitle, type SubtitleTrack } from './subtitles.ts'

export type ProfileTrackDefaults = {
  audioLanguage: string
  subtitleLanguage: string
  subtitleMode: SubtitleMode
  animeOriginalAudio: boolean
}

export type TrackMemory = {
  audioLanguage?: string
  subtitleLanguage?: string
  subtitlesEnabled: boolean
}

export type ResolveTracksInput = {
  audio: readonly AudioStreamInfo[]
  subtitles: readonly SubtitleTrack[]
  profile?: ProfileTrackDefaults
  memory?: TrackMemory
  originalLanguage?: string
  genres?: readonly string[]
  burnInEnabled: boolean
  explicit?: { audioStreamIndex?: number; subtitle?: 'off' | { trackId: string } }
}

export type ResolvedTracks = {
  audio?: AudioStreamInfo
  subtitle?: SubtitleTrack
  burnIn: boolean
  origin: TrackSelectionOrigin
}

export type ResolveTracksError = AppError<'playback/subtitle_unsupported'>

export const languageBase = (language: string | undefined): string | undefined => {
  if (language === undefined) return undefined
  const trimmed = language.trim().toLowerCase()
  if (trimmed === '' || trimmed === 'und') return undefined
  return (normalizeLanguage(trimmed) ?? trimmed).split('-')[0]
}

const sameLanguage = (a: string | undefined, b: string | undefined): boolean => {
  const base = languageBase(a)
  return base !== undefined && base === languageBase(b)
}

type SubtitleWish = { mode: SubtitleMode; language?: string }
type Wish = { audioLanguage?: string; subtitles: SubtitleWish; origin: TrackSelectionOrigin }

const animeRuleApplies = (input: ResolveTracksInput): boolean =>
  input.profile?.animeOriginalAudio === true && isAnime(input)

const opt = <K extends string, V>(key: K, value: V | undefined) =>
  (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }

const wishOf = (input: ResolveTracksInput): Wish => {
  const { profile, memory } = input
  const anime = animeRuleApplies(input)
  const defaultAudio = anime ? input.originalLanguage : profile?.audioLanguage
  const defaultSubtitles: SubtitleWish =
    profile === undefined
      ? { mode: 'never' }
      : {
          mode: anime ? 'always' : profile.subtitleMode,
          language: profile.subtitleLanguage,
        }
  if (memory !== undefined) {
    return {
      ...opt('audioLanguage', memory.audioLanguage ?? defaultAudio),
      subtitles: memory.subtitlesEnabled
        ? {
            mode: 'always',
            ...opt('language', memory.subtitleLanguage ?? profile?.subtitleLanguage),
          }
        : { mode: 'never' },
      origin: 'memory',
    }
  }
  return {
    ...opt('audioLanguage', defaultAudio),
    subtitles: defaultSubtitles,
    origin: anime ? 'anime' : 'profile',
  }
}

const bestAudio = (tracks: readonly AudioStreamInfo[]): AudioStreamInfo | undefined =>
  [...tracks].sort(
    (a, b) => Number(b.isDefault) - Number(a.isDefault) || (b.channels ?? 0) - (a.channels ?? 0),
  )[0]

export const pickAudio = (
  tracks: readonly AudioStreamInfo[],
  wantedLanguage: string | undefined,
  originalLanguage: string | undefined,
): AudioStreamInfo | undefined => {
  const inLanguage = (language: string | undefined) =>
    bestAudio(tracks.filter((track) => sameLanguage(track.language, language)))
  const tagged = tracks.filter((track) => languageBase(track.language) !== undefined)
  return (
    inLanguage(wantedLanguage) ??
    inLanguage(originalLanguage) ??
    tagged.find((track) => track.isDefault) ??
    tagged[0] ??
    tracks.find((track) => track.isDefault) ??
    tracks[0]
  )
}

const subtitlePreference = (a: SubtitleTrack, b: SubtitleTrack): number =>
  Number(a.forced) - Number(b.forced) ||
  Number(a.origin !== 'external') - Number(b.origin !== 'external') ||
  Number(a.sdh) - Number(b.sdh)

export const pickSubtitle = ({
  tracks,
  wish,
  audioLanguage,
  burnInEnabled,
}: {
  tracks: readonly SubtitleTrack[]
  wish: SubtitleWish
  audioLanguage: string | undefined
  burnInEnabled: boolean
}): SubtitleTrack | undefined => {
  if (wish.mode === 'never') return undefined
  const usable = tracks.filter((track) => burnInEnabled || !isBitmapSubtitle(track))
  const inLanguage = usable
    .filter((track) => sameLanguage(track.language, wish.language))
    .sort(subtitlePreference)
  const audioDiffers =
    languageBase(audioLanguage) !== undefined && !sameLanguage(audioLanguage, wish.language)
  const full = wish.mode === 'always' || (wish.mode === 'when_audio_differs' && audioDiffers)
  if (!full) return inLanguage.find((track) => track.forced)
  const lone = tracks.length === 1 ? usable[0] : undefined
  const loneUntagged =
    lone !== undefined && languageBase(lone.language) === undefined ? lone : undefined
  return inLanguage[0] ?? loneUntagged
}

export const equivalentSubtitle = (
  like: SubtitleTrack,
  tracks: readonly SubtitleTrack[],
): SubtitleTrack | undefined => {
  const same = tracks.filter(
    (track) =>
      languageBase(track.language) === languageBase(like.language) &&
      track.forced === like.forced &&
      track.sdh === like.sdh,
  )
  return same.find((track) => track.origin === like.origin) ?? same[0]
}

export const resolveTracks = (
  input: ResolveTracksInput,
): Result<ResolvedTracks, ResolveTracksError> => {
  const wish = wishOf(input)
  const explicitAudio =
    input.explicit?.audioStreamIndex === undefined
      ? undefined
      : input.audio.find((track) => track.index === input.explicit?.audioStreamIndex)
  const explicitSubtitle = input.explicit?.subtitle
  const namedTrack =
    explicitSubtitle === undefined || explicitSubtitle === 'off'
      ? undefined
      : input.subtitles.find((track) => track.id === explicitSubtitle.trackId)
  if (namedTrack !== undefined && isBitmapSubtitle(namedTrack) && !input.burnInEnabled) {
    return err(
      appError('playback/subtitle_unsupported', 'bitmap subtitles need burn-in, which is off', {
        context: { trackId: namedTrack.id, format: namedTrack.format },
      }),
    )
  }
  const subtitleIsExplicit = explicitSubtitle === 'off' || namedTrack !== undefined

  const audio = explicitAudio ?? pickAudio(input.audio, wish.audioLanguage, input.originalLanguage)
  const subtitle = subtitleIsExplicit
    ? namedTrack
    : pickSubtitle({
        tracks: input.subtitles,
        wish: wish.subtitles,
        audioLanguage: audio?.language,
        burnInEnabled: input.burnInEnabled,
      })
  return ok({
    ...opt('audio', audio),
    ...opt('subtitle', subtitle),
    burnIn: subtitle !== undefined && isBitmapSubtitle(subtitle),
    origin: explicitAudio !== undefined || subtitleIsExplicit ? 'explicit' : wish.origin,
  })
}
