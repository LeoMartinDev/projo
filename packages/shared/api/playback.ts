import { z } from 'zod'

import { sourceVersionDtoSchema } from './versions.ts'

export const playbackModeSchema = z.enum(['direct', 'hls_remux', 'hls_transcode'])
export type PlaybackMode = z.infer<typeof playbackModeSchema>

export const videoCodecIdSchema = z.enum(['avc1', 'hvc1', 'av01', 'vp09'])
export type VideoCodecId = z.infer<typeof videoCodecIdSchema>

export const audioCodecIdSchema = z.enum(['mp4a.40.2', 'ec-3', 'ac-3', 'opus', 'flac'])
export type AudioCodecId = z.infer<typeof audioCodecIdSchema>

export const clientCapabilitiesSchema = z.object({
  videoCodecs: z.array(videoCodecIdSchema),
  audioCodecs: z.array(audioCodecIdSchema),
  hls: z.enum(['native', 'mse', 'none']),
  screenHeight: z.number().int().positive().optional(),
  subtitleDelivery: z.enum(['overlay', 'hls']).optional(),
})
export type ClientCapabilities = z.infer<typeof clientCapabilitiesSchema>

export const subtitleOffsetQuerySchema = z.object({
  subtitleOffsetMs: z.coerce.number().int().min(-10_000).max(10_000).optional(),
})

export const subtitleRenditionNames = (
  tracks: readonly { title?: string | undefined; language?: string | undefined }[],
): string[] => {
  const seen = new Map<string, number>()
  return tracks.map((track) => {
    const base = (track.title ?? track.language ?? '').replace(/["\r\n]/g, '').trim() || 'Subtitles'
    const count = (seen.get(base) ?? 0) + 1
    seen.set(base, count)
    return count === 1 ? base : `${base} (${count})`
  })
}

export const playbackQualitySchema = z.enum(['original', '1080p', '720p', '480p'])
export type PlaybackQuality = z.infer<typeof playbackQualitySchema>

export const createPlaybackSessionBodySchema = z.object({
  itemId: z.string().min(1),
  sourceId: z.string().min(1).optional(),
  capabilities: clientCapabilitiesSchema,
  audioStreamIndex: z.number().int().min(0).optional(),
  subtitleTrackId: z.union([z.string().min(1), z.literal('off')]).optional(),
  quality: playbackQualitySchema.default('original'),
  startPositionMs: z.number().int().min(0).optional(),
})
export type CreatePlaybackSessionBody = z.input<typeof createPlaybackSessionBodySchema>

export const playbackStreamDtoSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('direct'), url: z.string(), mimeType: z.string() }),
  z.object({ type: z.literal('hls'), url: z.string() }),
])
export type PlaybackStreamDto = z.infer<typeof playbackStreamDtoSchema>

export const audioTrackDtoSchema = z.object({
  index: z.number().int(),
  codec: z.string(),
  channels: z.number().int().optional(),
  language: z.string().optional(),
  title: z.string().optional(),
  isDefault: z.boolean(),
  delivery: z.enum(['direct', 'copy', 'aac']).optional(),
})
export type AudioTrackDto = z.infer<typeof audioTrackDtoSchema>

export const subtitleTrackDtoSchema = z.object({
  id: z.string(),
  origin: z.enum(['external', 'embedded']),
  format: z.string(),
  language: z.string().optional(),
  title: z.string().optional(),
  forced: z.boolean(),
  sdh: z.boolean(),
  isDefault: z.boolean(),
  delivery: z.enum(['vtt', 'burn_in', 'unsupported']),
  url: z.string().optional(),
})
export type SubtitleTrackDto = z.infer<typeof subtitleTrackDtoSchema>

export const mediaSegmentDtoSchema = z.object({
  type: z.enum(['intro', 'recap', 'credits', 'preview']),
  startMs: z.number().int(),
  endMs: z.number().int(),
})
export type MediaSegmentDto = z.infer<typeof mediaSegmentDtoSchema>

export const playbackVersionDtoSchema = z.object({
  sourceId: z.string(),
  version: sourceVersionDtoSchema,
  selected: z.boolean(),
})
export type PlaybackVersionDto = z.infer<typeof playbackVersionDtoSchema>

export const playbackPartDtoSchema = z.object({
  sourceId: z.string(),
  index: z.number().int(),
  offsetMs: z.number().int(),
  durationMs: z.number().int(),
})
export type PlaybackPartDto = z.infer<typeof playbackPartDtoSchema>

export const chapterDtoSchema = z.object({
  startMs: z.number().int(),
  endMs: z.number().int(),
  title: z.string().optional(),
})
export type ChapterDto = z.infer<typeof chapterDtoSchema>

export const trackSelectionOriginSchema = z.enum(['memory', 'anime', 'profile', 'explicit'])
export type TrackSelectionOrigin = z.infer<typeof trackSelectionOriginSchema>

export const playbackSessionDtoSchema = z.object({
  id: z.string(),
  itemId: z.string(),
  sourceId: z.string(),
  mode: playbackModeSchema,
  stream: playbackStreamDtoSchema,
  durationMs: z.number().int().optional(),
  startPositionMs: z.number().int(),
  heartbeatIntervalMs: z.number().int(),
  quality: playbackQualitySchema,
  availableQualities: z.array(playbackQualitySchema),
  audioTracks: z.array(audioTrackDtoSchema),
  selectedAudioStreamIndex: z.number().int().optional(),
  subtitleTracks: z.array(subtitleTrackDtoSchema),
  selectedSubtitleTrackId: z.string().optional(),
  trackSelection: trackSelectionOriginSchema,
  burnIn: z.boolean(),
  versions: z.array(playbackVersionDtoSchema),
  parts: z.array(playbackPartDtoSchema),
  partOffsetMs: z.number().int(),
  chapters: z.array(chapterDtoSchema),
  trickplayUrl: z.string().optional(),
  seekPointsMs: z.array(z.number().int()).optional(),
  segments: z.array(mediaSegmentDtoSchema),
})
export type PlaybackSessionDto = z.infer<typeof playbackSessionDtoSchema>

export const trackPreferencesBodySchema = z.object({
  audioLanguage: z.string().min(1).optional(),
  subtitleLanguage: z.string().min(1).optional(),
  subtitlesEnabled: z.boolean(),
})
export type TrackPreferencesBody = z.infer<typeof trackPreferencesBodySchema>

export const trackPreferencesDtoSchema = trackPreferencesBodySchema.extend({
  itemId: z.string(),
  updatedAt: z.string(),
})
export type TrackPreferencesDto = z.infer<typeof trackPreferencesDtoSchema>

export const trickplayIndexDtoSchema = z.object({
  interval: z.number().positive(),
  width: z.number().int(),
  height: z.number().int(),
  columns: z.number().int(),
  rows: z.number().int(),
  sheets: z.array(z.number().int()),
  times: z.array(z.number()).optional(),
})
export type TrickplayIndexDto = z.infer<typeof trickplayIndexDtoSchema>

export const adminPlaybackSessionDtoSchema = z.object({
  id: z.string(),
  account: z.object({ id: z.string(), name: z.string() }),
  profile: z.object({ id: z.string(), name: z.string(), color: z.string() }),
  item: z.object({
    id: z.string(),
    kind: z.enum(['movie', 'episode']),
    title: z.string().optional(),
    seriesTitle: z.string().optional(),
    seasonNumber: z.number().int().optional(),
    episodeNumber: z.number().int().optional(),
  }),
  mode: playbackModeSchema,
  quality: playbackQualitySchema,
  burnIn: z.boolean(),
  version: sourceVersionDtoSchema,
  positionMs: z.number().int(),
  durationMs: z.number().int().optional(),
  device: z.string().optional(),
  startedAt: z.string(),
  lastHeartbeatAt: z.string(),
})
export type AdminPlaybackSessionDto = z.infer<typeof adminPlaybackSessionDtoSchema>

export const playbackHeartbeatBodySchema = z.object({
  positionMs: z.number().int().min(0),
  paused: z.boolean().optional(),
})
export type PlaybackHeartbeatBody = z.infer<typeof playbackHeartbeatBodySchema>

export const playbackHeartbeatResponseSchema = z.object({
  sessionId: z.string(),
  positionMs: z.number().int(),
  watched: z.boolean(),
})
export type PlaybackHeartbeatResponse = z.infer<typeof playbackHeartbeatResponseSchema>

export const playbackSessionEndedSchema = z.object({
  sessionId: z.string(),
  endedAt: z.string(),
})
export type PlaybackSessionEnded = z.infer<typeof playbackSessionEndedSchema>
