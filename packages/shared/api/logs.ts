import { z } from 'zod'

import { isoDateTimeSchema, paginationQuerySchema } from './common.ts'

export const logLevels = ['debug', 'info', 'warn', 'error'] as const
export const logLevelSchema = z.enum(logLevels)
export type LogLevelDto = z.infer<typeof logLevelSchema>

/** Filters of the log viewer (§15): `level` is the minimum level, `q` a case-insensitive text. */
export const logFiltersSchema = z.object({
  level: logLevelSchema.optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
  q: z.string().trim().min(1).max(200).optional(),
})
export type LogFilters = z.infer<typeof logFiltersSchema>

export const adminLogsQuerySchema = paginationQuerySchema.extend(logFiltersSchema.shape)
export type AdminLogsQuery = z.infer<typeof adminLogsQuerySchema>

export const logEntryDtoSchema = z.object({
  id: z.string(),
  time: isoDateTimeSchema,
  level: logLevelSchema,
  message: z.string(),
  code: z.string().optional(),
  /** Every other field of the line (`module`, `jobId`, `requestId`, `error`…), as logged. */
  fields: z.record(z.string(), z.unknown()),
})
export type LogEntryDto = z.infer<typeof logEntryDtoSchema>

export const adminLogsPageSchema = z.object({
  items: z.array(logEntryDtoSchema),
  nextCursor: z.string().optional(),
})
export type AdminLogsPage = z.infer<typeof adminLogsPageSchema>
