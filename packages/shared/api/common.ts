import { z } from 'zod'

import { errorCodes } from '../errors/index.ts'

export const uuidSchema = z.uuid()
export const isoDateTimeSchema = z.iso.datetime({ offset: true })

export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: z.enum(errorCodes),
    message: z.string(),
    context: z.record(z.string(), z.unknown()).optional(),
  }),
})

/** Cursor pagination (§17.1): `?cursor=&limit=`. */
export const paginationQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})
export type PaginationQuery = z.infer<typeof paginationQuerySchema>

export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().optional(),
  })

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  runtime: z.string(),
})
export type HealthResponse = z.infer<typeof healthResponseSchema>
