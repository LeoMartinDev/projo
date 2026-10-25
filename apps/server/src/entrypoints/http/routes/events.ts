import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'

import type { CurrentEventSubscriber } from '../../../application/auth/event-subscriber.ts'
import { canReceiveEvent } from '../../../core/auth/event-audience.ts'
import type { EventBus } from '../../../core/events.ts'
import type { AppEnv } from '../context.ts'
import { currentPrincipal } from '../principal.ts'

/** `Bun.serve` closes a connection idle for 120 s: stay well below (§ CLAUDE.md "SSE"). */
export const defaultKeepAliveMs = 25_000

type Deps = {
  eventBus: EventBus
  /**
   * Who holds the stream, re-read on every event and keep-alive: a revoked or expired session or
   * a disabled account loses its stream; a demoted admin (or one switched to a restricted profile)
   * stops receiving admin events at once.
   */
  currentSubscriber: CurrentEventSubscriber
  /** Open streams, by their `close`: the module closes them on shutdown. */
  openStreams: Set<() => void>
  keepAliveMs?: number
}

/**
 * §17.1 SSE: `GET /events`, one stream per client (`new EventSource('/api/v1/events')`).
 * Each event is `event: <type>` + `data: <JSON payload>` (`packages/shared/api/events.ts`),
 * filtered by audience, re-read at each event: admin events for admins acting from an unrestricted
 * profile, `owning_session` events for that session only.
 * A `: keep-alive` comment is sent every 25 s.
 * Mounted at `/api/v1`. Middleware: per route or path-scoped, never `.use('*')`.
 */
export const eventsRoutes = ({
  eventBus,
  currentSubscriber,
  openStreams,
  keepAliveMs = defaultKeepAliveMs,
}: Deps) =>
  new Hono<AppEnv>().get('/events', (c) => {
    const principal = currentPrincipal(c)
    const logger = c.get('logger')

    return streamSSE(c, async (stream) => {
      // Writes are serialized: events and keep-alives never interleave inside a frame.
      let writing = Promise.resolve()
      const send = (write: () => Promise<unknown>) => {
        writing = writing.then(async () => {
          if (!stream.closed && !stream.aborted) await write()
        })
        return writing
      }

      let close = () => {}
      const closed = new Promise<void>((resolve) => {
        close = resolve
      })

      const unsubscribe = eventBus.subscribe((event) => {
        const subscriber = currentSubscriber(principal.session.id)
        if (subscriber === undefined) {
          close()
          return
        }
        if (!canReceiveEvent(event, subscriber)) return
        void send(() => stream.writeSSE({ event: event.type, data: JSON.stringify(event.payload) }))
      })
      const keepAlive = setInterval(() => {
        if (currentSubscriber(principal.session.id) === undefined) close()
        else void send(() => stream.write(': keep-alive\n\n'))
      }, keepAliveMs)
      stream.onAbort(close)
      openStreams.add(close)
      logger.debug('event stream opened')

      await send(() => stream.write(': connected\n\n'))
      await closed

      clearInterval(keepAlive)
      unsubscribe()
      openStreams.delete(close)
      logger.debug('event stream closed')
    })
  })

export type EventsRoutes = ReturnType<typeof eventsRoutes>
