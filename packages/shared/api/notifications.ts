import { z } from 'zod'

import { isoDateTimeSchema, paginationQuerySchema } from './common.ts'

export const notificationKinds = [
  'library/root_unreachable',
  'scan/source_stuck_pending',
  'scan/unsupported_layout',
  'scan/needs_review_count',
  'metadata/tmdb_key_missing',
  'tmdb/unauthorized',
  'job/failed',
  'update/available',
  'update/runtime_too_old',
  'update/failed',
  'update/rolled_back',
  'cache/disk_low',
  'playback/hw_accel_failed',
] as const
export const notificationKindSchema = z.enum(notificationKinds)
export type NotificationKind = z.infer<typeof notificationKindSchema>

export const notificationSeveritySchema = z.enum(['info', 'warning', 'error'])
export type NotificationSeverity = z.infer<typeof notificationSeveritySchema>

export const notificationStatusSchema = z.enum(['unread', 'read', 'resolved'])
export type NotificationStatus = z.infer<typeof notificationStatusSchema>

export const notificationsQuerySchema = paginationQuerySchema.extend({
  status: notificationStatusSchema.optional(),
})
export type NotificationsQuery = z.infer<typeof notificationsQuerySchema>

export const notificationDtoSchema = z.object({
  id: z.string(),
  kind: notificationKindSchema,
  severity: notificationSeveritySchema,
  titleKey: z.string(),
  context: z.record(z.string(), z.unknown()),
  createdAt: isoDateTimeSchema,
  readAt: isoDateTimeSchema.optional(),
  resolvedAt: isoDateTimeSchema.optional(),
})
export type NotificationDto = z.infer<typeof notificationDtoSchema>

export const notificationsPageSchema = z.object({
  items: z.array(notificationDtoSchema),
  nextCursor: z.string().optional(),
  unreadCount: z.number().int(),
})
export type NotificationsPage = z.infer<typeof notificationsPageSchema>

export const notificationResponseSchema = notificationDtoSchema
export type NotificationResponse = NotificationDto
