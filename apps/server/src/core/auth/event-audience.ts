import { serverEventAudience } from '@projo/shared/api/events'

import type { ServerEvent } from '../events.ts'

/**
 * §17.1 "filtered by audience": whether an SSE subscriber may receive `event`. `admin`: the account
 * is an admin acting from an unrestricted profile (§15), as read when the event is sent.
 */
export const canReceiveEvent = (
  event: ServerEvent,
  { admin, sessionId }: { admin: boolean; sessionId: string },
): boolean => {
  switch (serverEventAudience[event.type]) {
    case 'everyone':
      return true
    case 'admin':
      return admin
    case 'owning_session':
      return 'sessionId' in event.payload && event.payload.sessionId === sessionId
  }
}
