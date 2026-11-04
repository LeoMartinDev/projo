import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'

import type { CurrentEventSubscriber } from '../../../application/auth/event-subscriber.ts'
import { canReceiveEvent } from '../../../core/auth/event-audience.ts'
import type { EventBus } from '../../../core/events.ts'
import type { AppEnv } from '../context.ts'
import { currentPrincipal } from '../principal.ts'

export const defaultKeepAliveMs = 25_000

type Deps = {
  eventBus: EventBus
  currentSubscriber: CurrentEventSubscriber
  openStreams: Set<() => void>
  keepAliveMs?: number
}

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
