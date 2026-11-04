import { serverEventAudience } from '@projo/shared/api/events'

import type { ServerEvent } from '../events.ts'

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
