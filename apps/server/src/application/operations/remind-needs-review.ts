import type { Clock } from '../../core/clock.ts'
import {
  NEEDS_REVIEW_REMINDER_MS,
  type NeedsReviewReminderStore,
} from '../../core/notifications/notification.ts'
import type { AdminNotifier } from '../../core/notifications/notifier.ts'

type Deps = {
  countNeedsReview: () => number
  reminders: NeedsReviewReminderStore
  notifier: AdminNotifier
  clock: Clock
}

export const remindNeedsReviewFactory =
  ({ countNeedsReview, reminders, notifier, clock }: Deps) =>
  (): void => {
    const count = countNeedsReview()
    if (count === 0) {
      notifier.resolve({ kind: 'scan/needs_review_count', key: 'needs_review' })
      return
    }
    const now = clock.now()
    const last = reminders.read()
    if (last !== undefined && now.getTime() - last.getTime() < NEEDS_REVIEW_REMINDER_MS) return
    notifier.resolve({ kind: 'scan/needs_review_count', key: 'needs_review' })
    notifier.notify({
      kind: 'scan/needs_review_count',
      severity: 'info',
      key: 'needs_review',
      context: { count },
    })
    reminders.write(now)
  }

export type RemindNeedsReview = ReturnType<typeof remindNeedsReviewFactory>
