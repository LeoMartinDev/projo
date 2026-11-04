import { z } from 'zod'

export const segmentTypeSchema = z.enum(['intro', 'recap', 'credits', 'preview'])
export type SegmentTypeDto = z.infer<typeof segmentTypeSchema>

export const segmentOriginSchema = z.enum([
  'manual',
  'chapter',
  'theintrodb',
  'introdb',
  'skipdb',
  'fingerprint',
])
export type SegmentOriginDto = z.infer<typeof segmentOriginSchema>

export const segmentProviderIdSchema = z.enum(['theintrodb', 'introdb', 'skipdb'])
export type SegmentProviderIdDto = z.infer<typeof segmentProviderIdSchema>

export const itemSegmentDtoSchema = z.object({
  type: segmentTypeSchema,
  startMs: z.number().int(),
  endMs: z.number().int(),
  origin: segmentOriginSchema,
  confidence: z.number().optional(),
})
export type ItemSegmentDto = z.infer<typeof itemSegmentDtoSchema>

export const segmentLookupDtoSchema = z.object({
  source: z.enum(['chapter', 'theintrodb', 'introdb', 'skipdb', 'fingerprint']),
  outcome: z.enum(['found', 'none', 'no_segment', 'error']),
  checkedAt: z.string(),
})
export type SegmentLookupDto = z.infer<typeof segmentLookupDtoSchema>

export const itemSegmentsDtoSchema = z.object({
  itemId: z.string(),
  durationMs: z.number().int().optional(),
  segments: z.array(itemSegmentDtoSchema),
  absent: z.array(segmentTypeSchema),
  lookups: z.array(segmentLookupDtoSchema),
})
export type ItemSegmentsDto = z.infer<typeof itemSegmentsDtoSchema>

export const segmentTypeParamSchema = z.object({ id: z.string().min(1), type: segmentTypeSchema })

export const putSegmentBodySchema = z.union([
  z
    .object({
      startMs: z.number().int().min(0),
      endMs: z.number().int().min(1),
    })
    .refine((body) => body.endMs > body.startMs, {
      message: 'endMs must be after startMs',
      path: ['endMs'],
    }),
  z.object({ absent: z.literal(true) }),
])
export type PutSegmentBody = z.infer<typeof putSegmentBodySchema>

export const applyToSeasonBodySchema = z.object({
  types: z.array(segmentTypeSchema).min(1).optional(),
})
export type ApplyToSeasonBody = z.infer<typeof applyToSeasonBodySchema>

export const applyToSeasonResponseSchema = z.object({
  updated: z.number().int(),
  skipped: z.number().int(),
})
export type ApplyToSeasonResponse = z.infer<typeof applyToSeasonResponseSchema>

export const segmentSettingsDtoSchema = z.object({
  providers: z.array(segmentProviderIdSchema),
  theintrodbApiKey: z.object({ configured: z.boolean(), last4: z.string().optional() }),
  fingerprint: z.object({
    enabled: z.boolean(),
    introMinutes: z.number().int(),
    creditsMinutes: z.number().int(),
    minSeconds: z.number().int(),
    maxSeconds: z.number().int(),
    similarity: z.number(),
  }),
  contribution: z.enum(['off', 'manual_only']),
})
export type SegmentSettingsDto = z.infer<typeof segmentSettingsDtoSchema>

export const updateSegmentSettingsBodySchema = z
  .object({
    providers: z
      .array(segmentProviderIdSchema)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'duplicate provider' }),
    theintrodbApiKey: z.union([z.string().trim().min(8).max(1024), z.literal('')]),
    fingerprint: z
      .object({
        enabled: z.boolean(),
        introMinutes: z.number().int().min(1).max(30),
        creditsMinutes: z.number().int().min(1).max(15),
        minSeconds: z.number().int().min(5).max(120),
        maxSeconds: z.number().int().min(30).max(600),
        similarity: z.number().min(0.5).max(1),
      })
      .partial()
      .refine(
        ({ minSeconds, maxSeconds }) =>
          minSeconds === undefined || maxSeconds === undefined || minSeconds < maxSeconds,
        { message: 'minSeconds must be below maxSeconds', path: ['maxSeconds'] },
      ),
    contribution: z.enum(['off', 'manual_only']),
  })
  .partial()
export type UpdateSegmentSettingsBody = z.infer<typeof updateSegmentSettingsBodySchema>
