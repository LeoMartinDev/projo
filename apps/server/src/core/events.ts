import {
  type ServerEvent,
  type ServerEventPayloads,
  serverEventSchemas,
  type ServerEventType,
} from '@projo/shared/api/events'

import type { JobType } from './jobs/job.ts'

export type { ServerEvent, ServerEventPayloads, ServerEventType }

/**
 * Events between modules only: typed here, never streamed to clients. A fact clients also need
 * is a client event (`@projo/shared/api/events`) that modules observe as well; a name is never
 * both.
 */
export type InternalEventPayloads = {
  /**
   * A job ended for good: done, or failed with no attempt left (cancelled jobs are not
   * included). The payload is the stored one, unparsed: a subscriber parses what it needs.
   */
  'job.finished': { jobId: string; type: JobType; state: 'done' | 'failed'; payload: unknown }
}

type MustHold<T extends true> = T
/** Does not compile when an internal event takes a client event's name. */
export type InternalEventNamesAreFree = MustHold<
  [Extract<keyof InternalEventPayloads, ServerEventType>] extends [never] ? true : false
>

export type EventPayloads = ServerEventPayloads & InternalEventPayloads
export type EventType = keyof EventPayloads

export const isServerEventType = (type: EventType): type is ServerEventType =>
  Object.hasOwn(serverEventSchemas, type)

export type Unsubscribe = () => void

/**
 * Runs an effect once the database transaction open on this call has committed, at once when
 * none is open, never when it rolls back.
 */
export type AfterCommit = (effect: () => void) => void

export type EventBus = {
  /**
   * Delivers after the transaction that publishes it commits (at once outside a transaction),
   * not at all if it rolls back.
   */
  publish: <T extends EventType>(type: T, payload: EventPayloads[T]) => void
  /** Listens to one event type, client or internal. */
  on: <T extends EventType>(type: T, listener: (payload: EventPayloads[T]) => void) => Unsubscribe
  /** Every client event, for the client stream: internal events never reach it. */
  subscribe: (listener: (event: ServerEvent) => void) => Unsubscribe
}
