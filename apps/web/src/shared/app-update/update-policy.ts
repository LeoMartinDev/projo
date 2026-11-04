export type UpdateTrigger = 'boot' | 'resume' | 'reconnect' | 'hide'

export type UpdateAction = 'reload' | 'offer'

export const updateAction = ({
  trigger,
  hidden,
  playing,
}: {
  trigger: UpdateTrigger
  hidden: boolean
  playing: boolean
}): UpdateAction => {
  if (playing) return 'offer'
  if (trigger === 'boot' || trigger === 'resume' || trigger === 'hide' || hidden) return 'reload'
  return 'offer'
}

export type Attempts = {
  read: () => string | undefined
  write: (value: string) => void
  clear: () => void
}

export type UpdaterDeps = {
  activateLatest: () => Promise<void>
  resetWorker: () => Promise<void>
  reload: () => void
  attempts: Attempts
}

export const createUpdater = ({ activateLatest, resetWorker, reload, attempts }: UpdaterDeps) => ({
  apply: async (target: string): Promise<'reloading' | 'gave_up'> => {
    const previous = attempts.read()
    if (previous === `${target}:reset`) return 'gave_up'
    if (previous === target) {
      attempts.write(`${target}:reset`)
      await resetWorker()
    } else {
      attempts.write(target)
      await activateLatest()
    }
    reload()
    return 'reloading'
  },
  settled: () => attempts.clear(),
})
