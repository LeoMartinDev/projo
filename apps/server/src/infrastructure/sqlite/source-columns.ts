import { z } from 'zod'

import { type EditionId, editionIdSchema } from '@projo/shared/api/versions'

import type { MediaProbe } from '../../core/media/probe.ts'
import type { ParsedName } from '../../core/naming/index.ts'
import { parseJsonColumn } from './rows.ts'

// Zod schemas of the JSON columns of `sources` (§6: validated on read by `parseJsonColumn`).

export const parsedNameSchema = z.object({
  title: z.string().optional(),
  year: z.number().int().optional(),
  series: z.string().optional(),
  season: z.number().int().optional(),
  episode: z.number().int().optional(),
  episodeEnd: z.number().int().optional(),
  episodeTitle: z.string().optional(),
  absoluteEpisode: z.number().int().optional(),
  absoluteEpisodeEnd: z.number().int().optional(),
  airDate: z.string().optional(),
  edition: editionIdSchema.optional(),
  editionName: z.string().optional(),
  part: z.object({ index: z.number().int(), label: z.string() }).optional(),
  ids: z
    .object({
      tmdb: z.number().int().optional(),
      imdb: z.string().optional(),
      tvdb: z.number().int().optional(),
    })
    .optional(),
})

/** `sources.parsed` → `ParsedName` (JSON never holds `undefined`, so the optional keys are exact). */
export const readParsedName = (value: unknown): ParsedName =>
  parseJsonColumn(parsedNameSchema, value, 'sources.parsed') as ParsedName

const parsedEditionSchema = z
  .object({
    edition: editionIdSchema.optional().catch(undefined),
    editionName: z.string().optional().catch(undefined),
  })
  .catch({})

/** The edition of `sources.parsed` alone (§7.7 version), lenient: what cannot be read is left out. */
export const readParsedEdition = (
  value: unknown,
): { edition?: EditionId | undefined; editionName?: string | undefined } =>
  parsedEditionSchema.parse(value)

const dynamicRangeSchema = z.enum(['sdr', 'hdr', 'dv'])

export const mediaProbeSchema = z.object({
  durationMs: z.number(),
  container: z.string(),
  bitRate: z.number().optional(),
  video: z.array(
    z.object({
      index: z.number().int(),
      codec: z.string(),
      profile: z.string().optional(),
      width: z.number().int().optional(),
      height: z.number().int().optional(),
      pixelFormat: z.string().optional(),
      frameRate: z.number().optional(),
      bitRate: z.number().optional(),
      dynamicRange: dynamicRangeSchema,
      isDefault: z.boolean(),
    }),
  ),
  audio: z.array(
    z.object({
      index: z.number().int(),
      codec: z.string(),
      profile: z.string().optional(),
      channels: z.number().int().optional(),
      channelLayout: z.string().optional(),
      sampleRate: z.number().optional(),
      bitRate: z.number().optional(),
      language: z.string().optional(),
      title: z.string().optional(),
      isDefault: z.boolean(),
    }),
  ),
  subtitles: z.array(
    z.object({
      index: z.number().int(),
      codec: z.string(),
      language: z.string().optional(),
      title: z.string().optional(),
      isDefault: z.boolean(),
      forced: z.boolean(),
      sdh: z.boolean(),
    }),
  ),
  chapters: z.array(
    z.object({ startMs: z.number(), endMs: z.number(), title: z.string().optional() }),
  ),
})

export const readMediaProbe = (value: unknown): MediaProbe =>
  parseJsonColumn(mediaProbeSchema, value, 'sources.probe') as MediaProbe
