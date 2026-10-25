import { z } from 'zod'

import { isoDateTimeSchema, paginationQuerySchema } from './common.ts'

/**
 * §15 "Notifications", §17.2: `GET /admin/notifications`, `POST /admin/notifications/:id/read`.
 * The web titles a notification with `admin.notifications.<kind>` and details it from `context`.
 */

/** Notifications raised in v1 (§15). The server keeps at most one open row per (kind, subject). */
export const notificationKinds = [
  'library/root_unreachable',
  'scan/source_stuck_pending',
  'scan/unsupported_layout',
  /** Daily, while "To review" is not empty (`context.count`). */
  'scan/needs_review_count',
  /** §9.1: no TMDB key, matching does not run. */
  'metadata/tmdb_key_missing',
  /** §15: TMDB refuses the stored key. */
  'tmdb/unauthorized',
  /** §18: a job failed on its last attempt (`context`: `jobId`, `jobType`, `code`, `message`). */
  'job/failed',
  /** §16.4: a newer release (`context.version`). Resolved once it is installed. */
  'update/available',
  /** §16.4: the newer release needs a newer runtime (`context`: `version`, `runtimeMin`, `pullCommand`). */
  'update/runtime_too_old',
  /** `apply_update` failed before the switch (`context`: `version`, `code`, `message`). */
  'update/failed',
  /** §16.3: the new version did not become healthy; the supervisor went back (`context`: `from`, `to`). */
  'update/rolled_back',
  /** Less than 2 GB free on `/data` (§15). */
  'cache/disk_low',
] as const
export const notificationKindSchema = z.enum(notificationKinds)
export type NotificationKind = z.infer<typeof notificationKindSchema>

export const notificationSeveritySchema = z.enum(['info', 'warning', 'error'])
export type NotificationSeverity = z.infer<typeof notificationSeveritySchema>

/**
 * `unread`: neither read nor resolved (the menu badge). `read`: read, not resolved. `resolved`: the
 * condition is over (root reachable again, release installed…), read or not.
 */
export const notificationStatusSchema = z.enum(['unread', 'read', 'resolved'])
export type NotificationStatus = z.infer<typeof notificationStatusSchema>

/** `GET /admin/notifications?status=&cursor=&limit=`, newest first; without `status`: all. */
export const notificationsQuerySchema = paginationQuerySchema.extend({
  status: notificationStatusSchema.optional(),
})
export type NotificationsQuery = z.infer<typeof notificationsQuerySchema>

export const notificationDtoSchema = z.object({
  id: z.string(),
  kind: notificationKindSchema,
  severity: notificationSeveritySchema,
  /** Translation key of the title (today the kind itself). */
  titleKey: z.string(),
  /** Details for the message (paths, ids, codes): admin only, sent as stored. */
  context: z.record(z.string(), z.unknown()),
  createdAt: isoDateTimeSchema,
  readAt: isoDateTimeSchema.optional(),
  resolvedAt: isoDateTimeSchema.optional(),
})
export type NotificationDto = z.infer<typeof notificationDtoSchema>

/** `unreadCount`: all pages, every status filter (the menu badge, §15). */
export const notificationsPageSchema = z.object({
  items: z.array(notificationDtoSchema),
  nextCursor: z.string().optional(),
  unreadCount: z.number().int(),
})
export type NotificationsPage = z.infer<typeof notificationsPageSchema>

/** `POST /admin/notifications/:id/read`: 200 with the notification (idempotent). */
export const notificationResponseSchema = notificationDtoSchema
export type NotificationResponse = NotificationDto
