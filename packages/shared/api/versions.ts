import { z } from 'zod'

/**
 * §7.7 versions of an item: what tells its files apart, as codes. Nothing composed is stored or
 * sent: the web builds the label (`2160p HDR HEVC · Version longue`) in the interface language.
 */

/** Width first, so that scope formats (1920×800) keep their class. `2160p` is shown as "4K". */
export const resolutionSchema = z.enum(['2160p', '1080p', '720p', 'SD'])
export type Resolution = z.infer<typeof resolutionSchema>

/** From ffprobe (§7.3): `hdr` = PQ (HDR10, HDR10+) or HLG, `dv` = Dolby Vision. */
export const dynamicRangeSchema = z.enum(['sdr', 'hdr', 'dv'])
export type DynamicRange = z.infer<typeof dynamicRangeSchema>

/**
 * §8.1 editions recognized in a file name, stored as these ids (`sources.parsed.edition`); the
 * label comes from the web locales (`editions.<id>`). A `{edition-…}` tag keeps its own text
 * (`editionName`).
 */
export const editionIds = [
  'directors_cut',
  'extended',
  'theatrical',
  'final_cut',
  'unrated',
  'uncut',
  'special_edition',
  'ultimate_edition',
  'imax',
  'remastered',
] as const

export const editionIdSchema = z.enum(editionIds)
export type EditionId = z.infer<typeof editionIdSchema>

/**
 * A version (§7.7), from the probe of its file and its parsed name; every field is absent when
 * unknown. `videoCodec`: ffprobe `codec_name` (`hevc`, `h264`, `av1`…). `edition` and
 * `editionName` are exclusive.
 */
export const sourceVersionDtoSchema = z.object({
  resolution: resolutionSchema.optional(),
  dynamicRange: dynamicRangeSchema.optional(),
  videoCodec: z.string().optional(),
  edition: editionIdSchema.optional(),
  editionName: z.string().optional(),
})
export type SourceVersionDto = z.infer<typeof sourceVersionDtoSchema>
