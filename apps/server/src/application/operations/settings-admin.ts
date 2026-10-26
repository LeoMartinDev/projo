import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type {
  PlaybackSettingsReader,
  PlaybackSettingsWriter,
  ServerNameStore,
} from '../../core/settings/settings.ts'
import type { PlaybackSettingsAdmin, ServerSettingsAdmin, ServerSettingsView } from './types.ts'

/**
 * §15 "Playback": what the admin edits of §10. Every use reads the settings again: a change
 * applies to the next session or job, without a restart.
 */
export const playbackSettingsAdminFactory = ({
  reader,
  writer,
  clock,
  logger,
}: {
  reader: PlaybackSettingsReader
  writer: PlaybackSettingsWriter
  clock: Clock
  logger: Logger
}): PlaybackSettingsAdmin => {
  const get = () => reader.read()
  return {
    get,
    update: (values) => {
      if (Object.keys(values).length > 0) {
        writer.write({ values, at: clock.now() })
        logger.info('playback settings changed', { keys: Object.keys(values) })
      }
      return get()
    },
  }
}

/** §15 "Server": the name is a setting; port, `TRUST_PROXY` and the data folder are env (§5.4). */
export const serverSettingsAdminFactory = ({
  store,
  environment,
  clock,
}: {
  store: ServerNameStore
  environment: Omit<ServerSettingsView, 'name'>
  clock: Clock
}): ServerSettingsAdmin => {
  const get = (): ServerSettingsView => ({ name: store.read(), ...environment })
  return {
    get,
    update: ({ name }) => {
      if (name !== undefined) store.write({ name, at: clock.now() })
      return get()
    },
  }
}
