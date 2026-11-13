import type { Clock } from '../../core/clock.ts'
import type { Logger } from '../../core/logger.ts'
import type {
  PlaybackSettings,
  PlaybackSettingsReader,
  PlaybackSettingsWriter,
} from '../../core/settings/settings.ts'

type Deps = {
  reader: PlaybackSettingsReader
  writer: PlaybackSettingsWriter
  clock: Clock
  logger: Logger
}

export const updatePlaybackSettingsFactory =
  ({ reader, writer, clock, logger }: Deps) =>
  (values: Partial<PlaybackSettings>): PlaybackSettings => {
    if (Object.keys(values).length > 0) {
      writer.write({ values, at: clock.now() })
      logger.info('playback settings changed', { keys: Object.keys(values) })
    }
    return reader.read()
  }

export type UpdatePlaybackSettings = ReturnType<typeof updatePlaybackSettingsFactory>
