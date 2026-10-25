import type { NotificationErrorCode } from '@projo/shared'

import type { ErrorStatusMap } from './types.ts'

export const notificationErrorStatus = {
  'notification/not_found': 404,
} satisfies ErrorStatusMap<NotificationErrorCode>
