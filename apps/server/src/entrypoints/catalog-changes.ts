import type { EventBus } from '../core/events.ts'

/** Job types whose end changes what the catalogue shows (§9: identification, images, refresh). */
const catalogJobs = new Set(['match_source', 'fetch_images', 'refresh_metadata'])

/** At most one `catalog.changed` per window (§17.1). */
export const defaultCatalogChangedWindowMs = 2_000

/**
 * Publishes `catalog.changed` (audience `everyone`, no detail) after the events that change the
 * catalogue: a source ready, a scan finished, a `match_source` / `fetch_images` /
 * `refresh_metadata` job done. A burst (a whole library identified) gives one event per window, at
 * its end. `stop` drops a pending one.
 */
export const startCatalogChanges = ({
  eventBus,
  windowMs = defaultCatalogChangedWindowMs,
}: {
  eventBus: EventBus
  windowMs?: number
}) => {
  let pending: ReturnType<typeof setTimeout> | undefined
  const schedule = () => {
    if (pending !== undefined) return
    pending = setTimeout(() => {
      pending = undefined
      eventBus.publish('catalog.changed', {})
    }, windowMs)
  }
  const unsubscribe = eventBus.subscribe((event) => {
    if (
      event.type === 'source.ready' ||
      event.type === 'scan.finished' ||
      (event.type === 'job.updated' &&
        event.payload.state === 'done' &&
        catalogJobs.has(event.payload.type))
    ) {
      schedule()
    }
  })
  return {
    stop: () => {
      unsubscribe()
      clearTimeout(pending)
      pending = undefined
    },
  }
}
