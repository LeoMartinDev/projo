import type { ServerEvent, ServerEventPayloads, ServerEventType } from '@projo/shared/api/events'

export type { ServerEvent, ServerEventPayloads, ServerEventType }

export type EventListener = (event: ServerEvent) => void
export type Unsubscribe = () => void

export type EventBus = {
  publish: <T extends ServerEventType>(type: T, payload: ServerEventPayloads[T]) => void
  subscribe: (listener: EventListener) => Unsubscribe
}
