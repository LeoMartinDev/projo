import { updateAction, type UpdateTrigger } from './update-policy.ts'

export type UpdateWatcherDeps = {
  readServerVersion: () => Promise<string | undefined>
  webVersion: () => string
  updater: {
    apply: (target: string) => Promise<'reloading' | 'gave_up'>
    settled: () => void
  }
  isHidden: () => boolean
  isPlaying: () => boolean
}

export const createUpdateWatcher = ({
  readServerVersion,
  webVersion,
  updater,
  isHidden,
  isPlaying,
}: UpdateWatcherDeps) => {
  let offered: string | undefined
  const listeners = new Set<() => void>()

  const offer = (target: string | undefined) => {
    if (offered === target) return
    offered = target
    for (const listener of listeners) listener()
  }

  let applying = false
  const apply = async (target: string): Promise<void> => {
    if (applying) return
    applying = true
    if ((await updater.apply(target)) === 'reloading') return
    applying = false
    offer(undefined)
  }

  const handle = (trigger: UpdateTrigger, target: string): Promise<void> => {
    if (updateAction({ trigger, hidden: isHidden(), playing: isPlaying() }) === 'reload')
      return apply(target)
    offer(target)
    return Promise.resolve()
  }

  return {
    check: async (trigger: UpdateTrigger): Promise<void> => {
      const version = await readServerVersion()
      if (version === undefined) return
      if (version !== webVersion()) return handle(trigger, version)
      updater.settled()
      offer(undefined)
    },
    hidden: (): Promise<void> =>
      offered === undefined ? Promise.resolve() : handle('hide', offered),
    applyOffered: (): Promise<void> => (offered === undefined ? Promise.resolve() : apply(offered)),
    offered: (): string | undefined => offered,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
