import {
  type AfterCommit,
  type EventBus,
  type EventType,
  isServerEventType,
  type ServerEvent,
} from '../../core/events.ts'
import type { Logger } from '../../core/logger.ts'

type Listener = (payload: never) => void

const immediately: AfterCommit = (effect) => effect()

/**
 * Synchronous delivery, deferred by `afterCommit` while a transaction is open (the SQLite
 * one: `afterCommit` of `infrastructure/sqlite/transactions.ts`). A throwing listener is logged
 * and the others still receive the event.
 */
export const createInMemoryEventBus = ({
  logger,
  afterCommit = immediately,
}: {
  logger: Logger
  afterCommit?: AfterCommit
}): EventBus => {
  const byType = new Map<EventType, Set<Listener>>()
  const clientListeners = new Set<(event: ServerEvent) => void>()

  const guarded = (type: EventType, call: () => void): void => {
    try {
      call()
    } catch (error) {
      logger.error('event listener failed', { eventType: type, error })
    }
  }

  const deliver = (type: EventType, payload: unknown): void => {
    for (const listener of byType.get(type) ?? []) {
      guarded(type, () => (listener as (payload: unknown) => void)(payload))
    }
    if (!isServerEventType(type)) return
    const event = { type, payload } as ServerEvent
    for (const listener of clientListeners) guarded(type, () => listener(event))
  }

  return {
    publish: (type, payload) => afterCommit(() => deliver(type, payload)),
    on: (type, listener) => {
      const listeners = byType.get(type) ?? new Set<Listener>()
      byType.set(type, listeners)
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    subscribe: (listener) => {
      clientListeners.add(listener)
      return () => {
        clientListeners.delete(listener)
      }
    },
  }
}
