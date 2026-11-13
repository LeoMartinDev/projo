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
  const subscriptions = [
    eventBus.on('source.ready', schedule),
    eventBus.on('scan.finished', schedule),
    eventBus.on('job.finished', (job) => {
      if (job.state === 'done' && catalogJobs.has(job.type)) schedule()
    }),
  ]
  return {
    stop: () => {
      for (const unsubscribe of subscriptions) unsubscribe()
      clearTimeout(pending)
      pending = undefined
    },
  }
}
