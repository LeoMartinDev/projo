import { eventSubscriberFactory } from '../../application/auth/event-subscriber.ts'
import { createSqliteAccountRepository } from '../../infrastructure/sqlite/account-repository.ts'
import { createSqliteProfileRepository } from '../../infrastructure/sqlite/profile-repository.ts'
import { createSqliteSessionRepository } from '../../infrastructure/sqlite/session-repository.ts'
import { startCatalogChanges } from '../catalog-changes.ts'
import { eventsRoutes } from '../http/routes/events.ts'
import type { Platform } from './platform.ts'
import { defineModule } from './types.ts'

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
  return defineModule({
    exposes: {
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
    },
    stop: () => {
      catalogChanges.stop()
      for (const close of [...openStreams]) close()
    },
  })
}
