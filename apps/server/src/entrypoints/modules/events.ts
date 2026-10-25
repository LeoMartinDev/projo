import { eventSubscriberFactory } from '../../application/auth/event-subscriber.ts'
import { createSqliteAccountRepository } from '../../infrastructure/sqlite/account-repository.ts'
import { createSqliteProfileRepository } from '../../infrastructure/sqlite/profile-repository.ts'
import { createSqliteSessionRepository } from '../../infrastructure/sqlite/session-repository.ts'
import { startCatalogChanges } from '../catalog-changes.ts'
import { eventsRoutes } from '../http/routes/events.ts'
import type { Platform } from './platform.ts'

/**
 * Wiring of the SSE stream (§17.1) on the platform `EventBus`, and of `catalog.changed` (coalesced
 * catalogue changes, for every profile). Open streams close on shutdown.
 */
export const buildEventsModule = (
  { db, clock, eventBus }: Platform,
  {
    keepAliveMs,
    catalogChangedWindowMs,
  }: { keepAliveMs?: number; catalogChangedWindowMs?: number } = {},
) => {
  const openStreams = new Set<() => void>()
  const catalogChanges = startCatalogChanges({
    eventBus,
    ...(catalogChangedWindowMs === undefined ? {} : { windowMs: catalogChangedWindowMs }),
  })
  return {
    routes: eventsRoutes({
      eventBus,
      currentSubscriber: eventSubscriberFactory({
        accountRepository: createSqliteAccountRepository({ db }),
        sessionRepository: createSqliteSessionRepository({ db }),
        profileRepository: createSqliteProfileRepository({ db }),
        clock,
      }),
      openStreams,
      ...(keepAliveMs === undefined ? {} : { keepAliveMs }),
    }),
    stop: () => {
      catalogChanges.stop()
      for (const close of [...openStreams]) close()
    },
  }
}
