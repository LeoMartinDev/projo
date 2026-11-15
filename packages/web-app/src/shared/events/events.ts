import { useEffect, useEffectEvent } from 'react'

import {
  type ServerEventPayloads,
  serverEventSchemas,
  type ServerEventType,
} from '@projo/shared/api/events'

import { boundHost } from '../host/bound-host.ts'

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

type Listener<K extends ServerEventType> = (payload: ServerEventPayloads[K]) => void

export type EventSourceLike = {
  addEventListener: (type: string, listener: (event: MessageEvent<string>) => void) => void
  close: () => void
  readyState: number
}

/** What the app gives the host when it opens the stream. */
export type EventsContext = {
  /** The server refused the stream with a 401: the session is over (the app signs out). */
  unauthorized: () => void
}

const reopenMs = 5000

export const createEventHub = (open: () => EventSourceLike) => {
  const listeners = new Map<ServerEventType, Set<(payload: unknown) => void>>()
  const reconnectListeners = new Set<() => void>()
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
    let resumed = reopened
    current.addEventListener('error', () => {
      resumed = true
      if (current.readyState !== 2 || source !== current) return
      current.close()
      reopenTimer = setTimeout(() => connect(true), reopenMs)
    })
    current.addEventListener('open', () => {
      if (resumed) reconnected()
      resumed = false
    })
  }

  const reconnected = () => {
    for (const listener of listeners.get('catalog.changed') ?? []) listener({})
    for (const listener of reconnectListeners) listener()
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

  const onReconnect = (listener: () => void): (() => void) => {
    reconnectListeners.add(listener)
    return () => {
      reconnectListeners.delete(listener)
    }
  }

  return { subscribe, onReconnect }
}

let unauthorized = () => {}

/** What a 401 on the stream does: the app's session-lost path, set by `mountApp`. */
export const onEventsUnauthorized = (handler: () => void): void => {
  unauthorized = handler
}

// The page's one stream, opened by the host (EventSource in the browser, a fetch stream on the
// desktop).
export const eventHub = createEventHub(() =>
  boundHost().openEvents({ unauthorized: () => unauthorized() }),
)

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
