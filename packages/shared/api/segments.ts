import { z } from 'zod'

/**
 * §12 Intros, credits and segments: `GET /items/:id/segments` (viewer), manual markers
 * `PUT/DELETE /admin/items/:id/segments/:type` and `POST /admin/items/:id/segments/apply-to-season`
 * (§17.2 Admin items). Positions in milliseconds on the item timeline.
 */

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
  /** 0 to 1. */
  confidence: z.number().optional(),
})
export type ItemSegmentDto = z.infer<typeof itemSegmentDtoSchema>

/**
 * What the chain asked about the item (`segment_lookups`), for the admin markers dialog:
 * `source` = `chapter`, a provider id or `fingerprint`.
 */
export const segmentLookupDtoSchema = z.object({
  source: z.enum(['chapter', 'theintrodb', 'introdb', 'skipdb', 'fingerprint']),
  outcome: z.enum(['found', 'none', 'no_segment', 'error']),
  checkedAt: z.string(),
})
export type SegmentLookupDto = z.infer<typeof segmentLookupDtoSchema>

/**
 * `GET /items/:id/segments` (movie or episode the profile sees). `absent`: types with a negative
 * marker ("Pas d'intro", §12.1). `lookups` only for an admin account (else empty).
 */
export const itemSegmentsDtoSchema = z.object({
  itemId: z.string(),
  durationMs: z.number().int().optional(),
  segments: z.array(itemSegmentDtoSchema),
  absent: z.array(segmentTypeSchema),
  lookups: z.array(segmentLookupDtoSchema),
})
export type ItemSegmentsDto = z.infer<typeof itemSegmentsDtoSchema>

/** `:id/segments/:type`: both validated, so the RPC type keeps `:id`. */
export const segmentTypeParamSchema = z.object({ id: z.string().min(1), type: segmentTypeSchema })

/**
 * `PUT /admin/items/:id/segments/:type` (§12.5): a manual marker (origin `manual`, replaces any
 * other origin), or `{ absent: true }` = negative marker "this work has no <type>" (removes the
 * segment of that type and stops the chain for it). Answers the item's `ItemSegmentsDto`.
 */
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

/**
 * `POST /admin/items/:id/segments/apply-to-season` (§12.2 row 1): copies the episode's manual
 * markers (and negative markers) of `types` (default: all its manual types) onto the other
 * episodes of its season, except those already manual for that type.
 */
export const applyToSeasonBodySchema = z.object({
  types: z.array(segmentTypeSchema).min(1).optional(),
})
export type ApplyToSeasonBody = z.infer<typeof applyToSeasonBodySchema>

export const applyToSeasonResponseSchema = z.object({
  /** Episodes that received at least one marker. */
  updated: z.number().int(),
  /** Episodes left alone (already manual for every type applied). */
  skipped: z.number().int(),
})
export type ApplyToSeasonResponse = z.infer<typeof applyToSeasonResponseSchema>

// ── Admin settings section (§15 "Intros and credits") ─────────────────────────────────────────────

export const segmentSettingsDtoSchema = z.object({
  /** Enabled providers, in the order they are asked; a provider absent is disabled. */
  providers: z.array(segmentProviderIdSchema),
  /** Never sent back: whether one is set and its last 4 characters. */
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

/**
 * Partial update of the section. `theintrodbApiKey`: checked against TheIntroDB before it is
 * stored (422 `segment/theintrodb_key_invalid`), `""` removes it. `contribution: manual_only`
 * needs a TheIntroDB key (422 `segment/contribution_requires_key`).
 */
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
