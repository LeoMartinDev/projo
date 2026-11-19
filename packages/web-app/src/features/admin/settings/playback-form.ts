import type { PlaybackSettingsDto } from '@projo/shared/api/settings'
import { err, ok, type Result } from '@projo/shared/result'

// The numbers of the Playback tab, live TV's included (§29.4).
export const playbackLimits = {
  maxConcurrentTranscodes: { min: 1, max: 16 },
  transcodeCacheMaxGb: { min: 1, max: 10_000 },
  liveWindowMinutes: { min: 1, max: 240 },
  liveCacheMaxGb: { min: 1, max: 10_000 },
} as const

export type PlaybackLimit = keyof typeof playbackLimits

export const playbackLimitKeys = [
  'maxConcurrentTranscodes',
  'transcodeCacheMaxGb',
  'liveWindowMinutes',
  'liveCacheMaxGb',
] as const satisfies readonly PlaybackLimit[]

export const playbackToggleKeys = [
  'audioDownmix',
  'burnInEnabled',
  'trickplayEnabled',
  'hwAccel',
] as const

export type PlaybackToggle = (typeof playbackToggleKeys)[number]

/** The Playback tab's form: the numbers as typed, the switches on or off. */
export type PlaybackDraft = Record<PlaybackLimit, string> & Record<PlaybackToggle, boolean>

export const playbackDraftOf = (playback: PlaybackSettingsDto): PlaybackDraft => ({
  maxConcurrentTranscodes: String(playback.maxConcurrentTranscodes),
  transcodeCacheMaxGb: String(playback.transcodeCacheMaxGb),
  liveWindowMinutes: String(playback.liveWindowMinutes),
  liveCacheMaxGb: String(playback.liveCacheMaxGb),
  audioDownmix: playback.audioDownmix === 'stereo',
  burnInEnabled: playback.burnInEnabled,
  trickplayEnabled: playback.trickplayEnabled,
  hwAccel: playback.hwAccel === 'vaapi',
})

const parseLimit = (key: PlaybackLimit, value: string): number | undefined => {
  const text = value.trim()
  const number = Number(text)
  const { min, max } = playbackLimits[key]
  return /^\d+$/u.test(text) && number >= min && number <= max ? number : undefined
}

/** The body of "Save": the changed fields only; or the numbers that are out of bounds. */
export const playbackChanges = (
  draft: PlaybackDraft,
  changed: Partial<PlaybackDraft>,
): Result<{ playback: Partial<PlaybackSettingsDto> }, readonly PlaybackLimit[]> => {
  const parsed = playbackLimitKeys.map((key) => [key, parseLimit(key, draft[key])] as const)
  const invalid = parsed.flatMap(([key, value]) => (value === undefined ? [key] : []))
  if (invalid.length > 0) return err(invalid)
  const limits: Partial<Pick<PlaybackSettingsDto, PlaybackLimit>> = Object.fromEntries(
    parsed.filter(([key, value]) => value !== undefined && changed[key] !== undefined),
  )
  return ok({
    playback: {
      ...limits,
      ...(changed.audioDownmix === undefined
        ? {}
        : { audioDownmix: draft.audioDownmix ? 'stereo' : 'keep' }),
      ...(changed.hwAccel === undefined ? {} : { hwAccel: draft.hwAccel ? 'vaapi' : 'off' }),
      ...(changed.burnInEnabled === undefined ? {} : { burnInEnabled: draft.burnInEnabled }),
      ...(changed.trickplayEnabled === undefined
        ? {}
        : { trickplayEnabled: draft.trickplayEnabled }),
    },
  })
}
