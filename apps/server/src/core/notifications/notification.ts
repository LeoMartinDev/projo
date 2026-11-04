import type {
  NotificationKind,
  NotificationSeverity,
  NotificationStatus,
} from '@projo/shared/api/notifications'

export type { NotificationKind, NotificationSeverity, NotificationStatus }

export const DISK_LOW_THRESHOLD_BYTES = 2 * 1024 ** 3

export type Notification = {
  id: string
  kind: NotificationKind
  severity: NotificationSeverity
  titleKey: string
  context: Record<string, unknown>
  createdAt: Date
  readAt?: Date
  resolvedAt?: Date
}

export type NotificationRepository = {
  list: (input: { status?: NotificationStatus; cursor?: string; limit: number }) => {
    items: Notification[]
    nextCursor?: string
  }
  unreadCount: () => number
  markRead: (input: { id: string; at: Date }) => Notification | undefined
}

export type NotificationPurge = {
  purgeResolvedBefore: (before: Date) => number
}

export const NEEDS_REVIEW_REMINDER_MS = 24 * 60 * 60_000

export type NeedsReviewReminderStore = {
  read: () => Date | undefined
  write: (at: Date) => void
}
