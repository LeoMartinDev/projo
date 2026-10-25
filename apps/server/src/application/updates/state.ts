import type { EventBus } from '../../core/events.ts'
import type { UpdateStateHolder } from '../../core/updates/update.ts'

type Live = ReturnType<UpdateStateHolder['current']>

const BUSY_STATES: ReadonlySet<Live['state']> = new Set(['downloading', 'applying', 'restarting'])

/** An update is downloading, writing its switch, or the server is stopping for it. */
export const isUpdateBusy = (state: Live['state']): boolean => BUSY_STATES.has(state)

const same = (a: Live, b: Live): boolean =>
  a.state === b.state && a.version === b.version && a.progress === b.progress

/**
 * The updater's live state (§16.4), in memory: published as `update.state` (§17.1) on every
 * change, identical updates (download progress at the same percent) skipped.
 */
export const createUpdateStateHolder = ({
  eventBus,
}: {
  eventBus: EventBus
}): UpdateStateHolder => {
  let live: Live = { state: 'idle' }
  return {
    current: () => live,
    set: (next) => {
      const normalized: Live = {
        state: next.state,
        ...(next.version === undefined ? {} : { version: next.version }),
        ...(next.progress === undefined ? {} : { progress: Math.round(next.progress) }),
      }
      if (same(live, normalized)) return
      live = normalized
      eventBus.publish('update.state', normalized)
    },
  }
}
