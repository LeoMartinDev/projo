import type { ServerEvent, ServerEventPayloads, ServerEventType } from '@projo/shared/api/events'

export type { ServerEvent, ServerEventPayloads, ServerEventType }

export type EventListener = (event: ServerEvent) => void
export type Unsubscribe = () => void

/** In-process publication of the §17.1 events; the SSE endpoint is one subscriber. */
export type EventBus = {
  publish: <T extends ServerEventType>(type: T, payload: ServerEventPayloads[T]) => void
  subscribe: (listener: EventListener) => Unsubscribe
}
