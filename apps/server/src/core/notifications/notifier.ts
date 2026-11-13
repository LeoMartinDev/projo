import type { NotificationKind } from './notification.ts'

/** Raises and resolves admin notifications (§15). Cross-cutting: every module reaches it on `Platform`. */
export type AdminNotifier = {
  notify: (input: {
    kind: NotificationKind
    severity: 'info' | 'warning' | 'error'
    key: string
    context: Record<string, unknown>
  }) => void
  resolve: (input: { kind: NotificationKind; key: string }) => void
}
