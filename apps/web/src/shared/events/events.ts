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
  readyState: number
}

/** Delay before reopening a stream the browser gave up on. */
const reopenMs = 5000

/**
 * One shared SSE connection (`GET /api/v1/events`, §17.1), opened with the first subscriber and
 * closed with the last. Payloads are validated with the shared Zod schemas; an invalid frame is
 * dropped. `EventSource` reconnects by itself after a network error, but gives up for good (CLOSED)
 * after a non-200 answer (a proxy's 502 during a restart): the hub then reopens it after
 * `reopenMs`, re-wires every listened type and, once open, signals `catalog.changed` for the
 * events missed meanwhile. A lost session stops it through the sign-out (last unsubscribe).
 */
export const createEventHub = (open: () => EventSourceLike) => {
  const listeners = new Map<ServerEventType, Set<(payload: unknown) => void>>()
  const wired = new Set<ServerEventType>()
  let source: EventSourceLike | undefined
  let reopenTimer: ReturnType<typeof setTimeout> | undefined

  const wire = (type: ServerEventType) => {
    if (source === undefined || wired.has(type)) return
    wired.add(type)
    source.addEventListener(type, (event) => {
      const parsed = serverEventSchemas[type].safeParse(parseJson(event.data))
      if (!parsed.success) return
      for (const listener of listeners.get(type) ?? []) listener(parsed.data)
    })
  }

  const connect = (reopened: boolean) => {
    const current = open()
    source = current
    wired.clear()
    for (const type of listeners.keys()) wire(type)
    current.addEventListener('error', () => {
      if (current.readyState !== 2 || source !== current) return
      current.close()
      reopenTimer = setTimeout(() => connect(true), reopenMs)
    })
    if (reopened)
      current.addEventListener('open', () => {
        for (const listener of listeners.get('catalog.changed') ?? []) listener({})
      })
  }

  const size = () => [...listeners.values()].reduce((total, set) => total + set.size, 0)

  const subscribe = <K extends ServerEventType>(type: K, listener: Listener<K>): (() => void) => {
    const set = listeners.get(type) ?? new Set()
    const untyped = listener as (payload: unknown) => void
    set.add(untyped)
    listeners.set(type, set)
    if (source === undefined) connect(false)
    else wire(type)
    return () => {
      set.delete(untyped)
      if (size() === 0 && source !== undefined) {
        clearTimeout(reopenTimer)
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
