import type {
  NotificationKind,
  NotificationSeverity,
  NotificationStatus,
} from '@projo/shared/api/notifications'

/**
 * §15 Notifications. Raised through `AdminNotifier` (`core/scanner/ports.ts`: one open row per
 * kind and subject `key`), listed and marked read by the admin.
 */

export type { NotificationKind, NotificationSeverity, NotificationStatus }

/** §15 `cache/disk_low`: less than this free on `/data`. */
export const DISK_LOW_THRESHOLD_BYTES = 2 * 1024 ** 3

export type Notification = {
  id: string
  kind: NotificationKind
  severity: NotificationSeverity
  titleKey: string
  /** Includes the subject `key` of `AdminNotifier`. */
  context: Record<string, unknown>
  createdAt: Date
  readAt?: Date
  resolvedAt?: Date
}

/** `notifications` (§6.5), admin side. Synchronous (bun:sqlite). */
export type NotificationRepository = {
  /** Newest first; cursor on `id` (UUID v7). */
  list: (input: { status?: NotificationStatus; cursor?: string; limit: number }) => {
    items: Notification[]
    nextCursor?: string
  }
  /** Neither read nor resolved (the menu badge). */
  unreadCount: () => number
  /** Sets `read_at` if unset (idempotent); `undefined` when the id is unknown. */
  markRead: (input: { id: string; at: Date }) => Notification | undefined
}

/** Retention: deletes the notifications resolved before `before`, returns how many. */
export type NotificationPurge = {
  purgeResolvedBefore: (before: Date) => number
}

/** §15 `scan/needs_review_count`: raised again at most this often while "To review" is not empty. */
export const NEEDS_REVIEW_REMINDER_MS = 24 * 60 * 60_000

/** When `scan/needs_review_count` was last raised (`settings.notifications.needs_review_notified_at`). */
export type NeedsReviewReminderStore = {
  read: () => Date | undefined
  write: (at: Date) => void
}
