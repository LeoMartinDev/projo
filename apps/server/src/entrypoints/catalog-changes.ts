import type { EventBus } from '../core/events.ts'

const catalogJobs = new Set(['match_source', 'fetch_images', 'refresh_metadata'])

export const defaultCatalogChangedWindowMs = 2_000

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
