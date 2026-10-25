import type { EventBus, EventListener, ServerEvent } from '../../core/events.ts'
import type { Logger } from '../../core/logger.ts'

/** Synchronous fan-out. A throwing listener is logged and never affects the publisher. */
export const createInMemoryEventBus = ({ logger }: { logger: Logger }): EventBus => {
  const listeners = new Set<EventListener>()

  return {
    publish: (type, payload) => {
      const event = { type, payload } as ServerEvent
      for (const listener of listeners) {
        try {
          listener(event)
        } catch (error) {
          logger.error('event listener failed', { eventType: type, error })
        }
      }
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
