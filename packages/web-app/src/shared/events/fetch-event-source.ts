import type { EventsContext, EventSourceLike } from './events.ts'
import { createSseParser } from './sse-parser.ts'

const connecting = 0
const open = 1
const closed = 2

/** How a stream that could not open ended: refused by the server (with its status), or failed. */
export type StreamRefusal = { status?: number }

type FetchEventSourceDeps = {
  /** Makes the request (`GET /api/v1/events` with the host's credentials). */
  connect: (signal: AbortSignal) => Promise<Response>
  /** The stream is open (a 2xx `text/event-stream`). */
  opened?: () => void
  /** The stream never opened: a status when the server answered something else. */
  refused?: (refusal: StreamRefusal) => void
}

const isEventStream = (response: Response): boolean =>
  (response.headers.get('content-type') ?? '').toLowerCase().startsWith('text/event-stream')

/**
 * One `EventSourceLike` over a `fetch` stream, for a page that must send a header (the desktop
 * app's bearer, §28.3). Any failure (refused, not a 2xx event stream, ended or broken) closes it
 * and signals `error` with `readyState` 2: the event hub opens a new one.
 */
export const fetchEventSource = ({
  connect,
  opened = () => undefined,
  refused = () => undefined,
}: FetchEventSourceDeps): EventSourceLike => {
  const listeners = new Map<string, Set<(event: MessageEvent<string>) => void>>()
  const controller = new AbortController()
  let readyState = connecting

  const dispatch = (type: string, data = '') => {
    const event = new MessageEvent<string>(type, { data })
    for (const listener of listeners.get(type) ?? []) listener(event)
  }

  const fail = () => {
    if (readyState === closed) return
    if (readyState === connecting) refused({})
    readyState = closed
    controller.abort()
    dispatch('error')
  }

  const parser = createSseParser((event) => {
    if (readyState === open) dispatch(event.type, event.data)
  })

  const read = async (body: ReadableStream<Uint8Array>) => {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    for (;;) {
      const { done, value } = await reader.read()
      if (done || readyState === closed) return
      parser.push(decoder.decode(value, { stream: true }))
    }
  }

  // The listeners are added right after the source is made: start on the next task.
  void Promise.resolve()
    .then(() => connect(controller.signal))
    .then(async (response) => {
      const body = response.body ?? undefined
      if (readyState === closed) return
      if (!response.ok || body === undefined || !isEventStream(response)) {
        void body?.cancel().catch(() => undefined)
        refused({ status: response.status })
        readyState = closed
        controller.abort()
        dispatch('error')
        return
      }
      readyState = open
      opened()
      dispatch('open')
      await read(body)
      fail()
    })
    .catch(fail)

  return {
    get readyState() {
      return readyState
    },
    addEventListener: (type, listener) => {
      const set = listeners.get(type) ?? new Set()
      set.add(listener)
      listeners.set(type, set)
    },
    close: () => {
      if (readyState === closed) return
      readyState = closed
      controller.abort()
    },
  }
}

/** Extra wait before the next attempt after `failures` streams in a row never opened. */
export const eventsBackoffMs = (failures: number): number =>
  failures <= 0 ? 0 : Math.min(60_000, 5_000 * 2 ** (failures - 1))

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    })
  })

/**
 * The desktop host's `openEvents` (§28.3): streams over `fetch` (`connect` adds the bearer). A
 * 401 hands over to the app's session-lost path (`unauthorized`); any refusal or failure before
 * the stream opened makes the next attempt wait longer (`eventsBackoffMs`), until one opens.
 */
export const createFetchEvents = ({
  connect,
  wait = sleep,
}: {
  connect: (signal: AbortSignal) => Promise<Response>
  wait?: (ms: number, signal: AbortSignal) => Promise<void>
}) => {
  let failures = 0
  return ({ unauthorized }: EventsContext): EventSourceLike =>
    fetchEventSource({
      connect: async (signal) => {
        const delay = eventsBackoffMs(failures)
        if (delay > 0) await wait(delay, signal)
        if (signal.aborted) throw new Error('closed')
        return connect(signal)
      },
      opened: () => {
        failures = 0
      },
      refused: ({ status }) => {
        failures += 1
        if (status === 401) unauthorized()
      },
    })
}
