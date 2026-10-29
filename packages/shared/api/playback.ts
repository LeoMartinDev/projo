import { z } from 'zod'

import { sourceVersionDtoSchema } from './versions.ts'

/** Schemas for `/api/v1/playback`, `/stream`, subtitles, trickplay (§17.2 Lecture). */

export const playbackModeSchema = z.enum(['direct', 'hls_remux', 'hls_transcode'])
export type PlaybackMode = z.infer<typeof playbackModeSchema>

// ── Client capabilities (§10.2) ──────────────────────────────────────────────

/** The fixed list of video codecs the client tests (`avc1` = H.264, `hvc1` = HEVC). */
export const videoCodecIdSchema = z.enum(['avc1', 'hvc1', 'av01', 'vp09'])
export type VideoCodecId = z.infer<typeof videoCodecIdSchema>

/** The fixed list of audio codecs the client tests (`mp4a.40.2` = AAC-LC). */
export const audioCodecIdSchema = z.enum(['mp4a.40.2', 'ec-3', 'ac-3', 'opus', 'flac'])
export type AudioCodecId = z.infer<typeof audioCodecIdSchema>

/**
 * What the browser can play, sent with every `POST /playback/sessions`. A codec is listed when
 * `MediaSource.isTypeSupported` (or `video.canPlayType` without MSE) and
 * `navigator.mediaCapabilities.decodingInfo` both say yes. `hls`: `native` when
 * `video.canPlayType('application/vnd.apple.mpegurl')` (Safari), `mse` when hls.js can run,
 * `none` otherwise.
 */
export const clientCapabilitiesSchema = z.object({
  videoCodecs: z.array(videoCodecIdSchema),
  audioCodecs: z.array(audioCodecIdSchema),
  hls: z.enum(['native', 'mse', 'none']),
  screenHeight: z.number().int().positive().optional(),
  /**
   * How text subtitles are shown (§10.4): `overlay` (absent: the default) = WebVTT files drawn by
   * the client; `hls` = renditions of the HLS stream, drawn by the platform player (iOS app, the
   * web on iOS/iPadOS Safari), so they follow into Picture-in-Picture and AirPlay.
   */
  subtitleDelivery: z.enum(['overlay', 'hls']).optional(),
})
export type ClientCapabilities = z.infer<typeof clientCapabilitiesSchema>

/** `?subtitleOffsetMs=` of `master.m3u8` and its renditions (§10.4): the subtitle delay. */
export const subtitleOffsetQuerySchema = z.object({
  subtitleOffsetMs: z.coerce.number().int().min(-10_000).max(10_000).optional(),
})

/**
 * `NAME` of each text subtitle rendition of a master playlist (§10.4), in the order of the
 * session's text tracks: the title, else the language, unique within the group. The web finds the
 * rendition among `video.textTracks` by this label.
 */
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

/**
 * `Original` keeps the source (transcoded at its own resolution, CRF 21, when it must be);
 * the others always mean `hls_transcode` at 8 / 4 / 1.5 Mb/s (§10.2).
 */
export const playbackQualitySchema = z.enum(['original', '1080p', '720p', '480p'])
export type PlaybackQuality = z.infer<typeof playbackQualitySchema>

// ── Sessions (§10.6) ─────────────────────────────────────────────────────────

/**
 * `POST /playback/sessions`.
 * - `sourceId`: the version to play, any of its parts (§7.7); default: the best version playable
 *   without a video transcode, else the highest resolution.
 * - `audioStreamIndex` (ffprobe index) and `subtitleTrackId` (`SubtitleTrackDto.id`, or `off`):
 *   an explicit choice, sent when the viewer changes a track; absent, the §11 cascade decides.
 * - `startPositionMs`: item position (cumulative over the parts of a stacked movie); the session
 *   plays the part that contains it. Absent: the profile's resume position.
 */
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

/** `direct`: progressive file with `Range` (`<video src>`). `hls`: VOD playlist (hls.js, or native on Safari). */
export const playbackStreamDtoSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('direct'), url: z.string(), mimeType: z.string() }),
  z.object({ type: z.literal('hls'), url: z.string() }),
])
export type PlaybackStreamDto = z.infer<typeof playbackStreamDtoSchema>

export const audioTrackDtoSchema = z.object({
  /** ffprobe stream index, the value of `audioStreamIndex`. */
  index: z.number().int(),
  codec: z.string(),
  channels: z.number().int().optional(),
  language: z.string().optional(),
  title: z.string().optional(),
  isDefault: z.boolean(),
  /** How this track reaches the browser if chosen: as is, or transcoded to AAC. */
  delivery: z.enum(['direct', 'copy', 'aac']).optional(),
})
export type AudioTrackDto = z.infer<typeof audioTrackDtoSchema>

/**
 * A subtitle track of the played source (§10.4), external file or embedded stream. `id` is the
 * `source_subtitles` row. `delivery`: `vtt` = text track served as WebVTT at `url` (a `<track>`,
 * whatever the mode); `burn_in` = bitmap, choosing it restarts the session in `hls_transcode`
 * with the track burnt in; `unsupported` = bitmap while `settings.burn_in_enabled` is off
 * (listed greyed out).
 */
export const subtitleTrackDtoSchema = z.object({
  id: z.string(),
  origin: z.enum(['external', 'embedded']),
  /** `srt`, `ass`, `subrip`, `hdmv_pgs_subtitle`… */
  format: z.string(),
  language: z.string().optional(),
  title: z.string().optional(),
  forced: z.boolean(),
  sdh: z.boolean(),
  isDefault: z.boolean(),
  delivery: z.enum(['vtt', 'burn_in', 'unsupported']),
  /** `/api/v1/subtitles/:sourceId/:trackId.vtt` when `delivery = vtt`. */
  url: z.string().optional(),
})
export type SubtitleTrackDto = z.infer<typeof subtitleTrackDtoSchema>

/** Known intro/credits segments of the item (§12, filled from M4). */
export const mediaSegmentDtoSchema = z.object({
  type: z.enum(['intro', 'recap', 'credits', 'preview']),
  startMs: z.number().int(),
  endMs: z.number().int(),
})
export type MediaSegmentDto = z.infer<typeof mediaSegmentDtoSchema>

/**
 * A version of the item (§7.7): one source, or the parts of a stack (`version` of its first
 * part), labelled by the web (`2160p HDR HEVC`).
 */
export const playbackVersionDtoSchema = z.object({
  /** First part of the version: the `sourceId` to send to switch to it. */
  sourceId: z.string(),
  version: sourceVersionDtoSchema,
  selected: z.boolean(),
})
export type PlaybackVersionDto = z.infer<typeof playbackVersionDtoSchema>

/** A part of a stacked movie (`cd1`, `part2`), positioned on the item timeline. */
export const playbackPartDtoSchema = z.object({
  sourceId: z.string(),
  index: z.number().int(),
  offsetMs: z.number().int(),
  durationMs: z.number().int(),
})
export type PlaybackPartDto = z.infer<typeof playbackPartDtoSchema>

/** A chapter of the played file, on the stream timeline. */
export const chapterDtoSchema = z.object({
  startMs: z.number().int(),
  endMs: z.number().int(),
  title: z.string().optional(),
})
export type ChapterDto = z.infer<typeof chapterDtoSchema>

/**
 * Where the selected tracks come from (§11.2), for the player: `memory` = this series' (or
 * movie's) `track_preferences`, `anime` = the original-audio rule, `profile` = the profile
 * defaults, `explicit` = the request named them.
 */
export const trackSelectionOriginSchema = z.enum(['memory', 'anime', 'profile', 'explicit'])
export type TrackSelectionOrigin = z.infer<typeof trackSelectionOriginSchema>

/**
 * Positions: `startPositionMs`, `durationMs`, heartbeats and segments are on the **item**
 * timeline (cumulative over the parts of a stack); the stream starts at 0 at the beginning of
 * the current part, at `partOffsetMs` on the item timeline. Chapters and trickplay are on the
 * stream timeline.
 */
export const playbackSessionDtoSchema = z.object({
  id: z.string(),
  itemId: z.string(),
  sourceId: z.string(),
  mode: playbackModeSchema,
  stream: playbackStreamDtoSchema,
  durationMs: z.number().int().optional(),
  /** Where to start: `startPositionMs` if given, else the profile's resume position (0 if none). */
  startPositionMs: z.number().int(),
  /** Send `PUT /playback/sessions/:id/heartbeat` at least this often (and on pause, seek, close). */
  heartbeatIntervalMs: z.number().int(),
  quality: playbackQualitySchema,
  /** `original` plus the lower qualities not above the source height. */
  availableQualities: z.array(playbackQualitySchema),
  audioTracks: z.array(audioTrackDtoSchema),
  selectedAudioStreamIndex: z.number().int().optional(),
  subtitleTracks: z.array(subtitleTrackDtoSchema),
  /** Absent: subtitles off. */
  selectedSubtitleTrackId: z.string().optional(),
  trackSelection: trackSelectionOriginSchema,
  /** The selected subtitle track is burnt into the video ("Burned-in subtitles, reduced quality"). */
  burnIn: z.boolean(),
  versions: z.array(playbackVersionDtoSchema),
  /** Parts of the version, in order; a single entry for an unstacked source. */
  parts: z.array(playbackPartDtoSchema),
  partOffsetMs: z.number().int(),
  chapters: z.array(chapterDtoSchema),
  /** `/api/v1/trickplay/:sourceId/index.json` when the sprites of the played source exist. */
  trickplayUrl: z.string().optional(),
  segments: z.array(mediaSegmentDtoSchema),
})
export type PlaybackSessionDto = z.infer<typeof playbackSessionDtoSchema>

/**
 * `PUT /items/:id/track-preferences` (§11.3), `:id` = the played movie or episode: stored on the
 * movie, or on the episode's series. A language absent = no preference for that type;
 * `subtitlesEnabled: false` = subtitles turned off. `DELETE` removes the memory ("Undo" when
 * there was none before).
 */
export const trackPreferencesBodySchema = z.object({
  audioLanguage: z.string().min(1).optional(),
  subtitleLanguage: z.string().min(1).optional(),
  subtitlesEnabled: z.boolean(),
})
export type TrackPreferencesBody = z.infer<typeof trackPreferencesBodySchema>

export const trackPreferencesDtoSchema = trackPreferencesBodySchema.extend({
  /** The movie or series the memory is stored on. */
  itemId: z.string(),
  updatedAt: z.string(),
})
export type TrackPreferencesDto = z.infer<typeof trackPreferencesDtoSchema>

/** `GET /trickplay/:sourceId/index.json` (§10.5); sheets at `/trickplay/:sourceId/<n>.jpg`. */
export const trickplayIndexDtoSchema = z.object({
  /** Seconds between two thumbnails. */
  interval: z.number().positive(),
  width: z.number().int(),
  height: z.number().int(),
  columns: z.number().int(),
  rows: z.number().int(),
  /** Sheet numbers, in order: thumbnail `i` is on sheet `floor(i / (columns × rows))`. */
  sheets: z.array(z.number().int()),
})
export type TrickplayIndexDto = z.infer<typeof trickplayIndexDtoSchema>

/** `GET /admin/playback/sessions` (§10.6); `DELETE /admin/playback/sessions/:id` stops one (204). */
export const adminPlaybackSessionDtoSchema = z.object({
  id: z.string(),
  account: z.object({ id: z.string(), name: z.string() }),
  profile: z.object({ id: z.string(), name: z.string(), color: z.string() }),
  item: z.object({
    id: z.string(),
    kind: z.enum(['movie', 'episode']),
    /** Absent: an episode without a name of its own (§6.3). */
    title: z.string().optional(),
    seriesTitle: z.string().optional(),
    seasonNumber: z.number().int().optional(),
    episodeNumber: z.number().int().optional(),
  }),
  mode: playbackModeSchema,
  quality: playbackQualitySchema,
  burnIn: z.boolean(),
  /** Of the played source (§7.7). */
  version: sourceVersionDtoSchema,
  positionMs: z.number().int(),
  durationMs: z.number().int().optional(),
  /** Device of the auth session (user agent summary). */
  device: z.string().optional(),
  startedAt: z.string(),
  lastHeartbeatAt: z.string(),
})
export type AdminPlaybackSessionDto = z.infer<typeof adminPlaybackSessionDtoSchema>

/** `PUT /playback/sessions/:id/heartbeat`. */
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

/** `DELETE /playback/sessions/:id`. */
export const playbackSessionEndedSchema = z.object({
  sessionId: z.string(),
  endedAt: z.string(),
})
export type PlaybackSessionEnded = z.infer<typeof playbackSessionEndedSchema>
