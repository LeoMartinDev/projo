import { useEffect, useEffectEvent } from 'react'

import {
  type ServerEventPayloads,
  serverEventSchemas,
  type ServerEventType,
} from '@projo/shared/api/events'

import { apiPrefix } from '../api/client.ts'

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

type Listener<K extends ServerEventType> = (payload: ServerEventPayloads[K]) => void

/** Minimal `EventSource` surface, injectable in tests. */
export type EventSourceLike = {
  addEventListener: (type: string, listener: (event: MessageEvent<string>) => void) => void
  close: () => void
}

/**
 * One shared SSE connection (`GET /api/v1/events`, §17.1), opened with the first subscriber and
 * closed with the last. Payloads are validated with the shared Zod schemas; an invalid frame is
 * dropped. `EventSource` reconnects by itself after a network error.
 */
export const createEventHub = (open: () => EventSourceLike) => {
  const listeners = new Map<ServerEventType, Set<(payload: unknown) => void>>()
  const wired = new Set<ServerEventType>()
  let source: EventSourceLike | undefined

  const wire = (type: ServerEventType) => {
    if (source === undefined || wired.has(type)) return
    wired.add(type)
    source.addEventListener(type, (event) => {
      const parsed = serverEventSchemas[type].safeParse(parseJson(event.data))
      if (!parsed.success) return
      for (const listener of listeners.get(type) ?? []) listener(parsed.data)
    })
  }

  const size = () => [...listeners.values()].reduce((total, set) => total + set.size, 0)

  const subscribe = <K extends ServerEventType>(type: K, listener: Listener<K>): (() => void) => {
    const set = listeners.get(type) ?? new Set()
    const untyped = listener as (payload: unknown) => void
    set.add(untyped)
    listeners.set(type, set)
    if (source === undefined) source = open()
    wire(type)
    return () => {
      set.delete(untyped)
      if (size() === 0 && source !== undefined) {
        source.close()
        source = undefined
        wired.clear()
      }
    }
  }

  return { subscribe }
}

export const eventHub = createEventHub(
  () => new EventSource(`${apiPrefix}/events`, { withCredentials: true }),
)

/** Calls `handler` for each `type` event while the component is mounted. */
export const useServerEvent = <K extends ServerEventType>(
  type: K,
  handler: Listener<K>,
  enabled = true,
): void => {
  const onEvent = useEffectEvent(handler)
  useEffect(() => {
    if (!enabled) return
    return eventHub.subscribe(type, (payload) => onEvent(payload))
  }, [type, enabled])
}
