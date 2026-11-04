import { z } from 'zod'

export const resolutionSchema = z.enum(['2160p', '1080p', '720p', 'SD'])
export type Resolution = z.infer<typeof resolutionSchema>

export const dynamicRangeSchema = z.enum(['sdr', 'hdr', 'dv'])
export type DynamicRange = z.infer<typeof dynamicRangeSchema>

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

export const sourceVersionDtoSchema = z.object({
  resolution: resolutionSchema.optional(),
  dynamicRange: dynamicRangeSchema.optional(),
  videoCodec: z.string().optional(),
  edition: editionIdSchema.optional(),
  editionName: z.string().optional(),
})
export type SourceVersionDto = z.infer<typeof sourceVersionDtoSchema>
