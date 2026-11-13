import type { PlaybackSettings, PlaybackSettingsReader } from '../../core/settings/settings.ts'

type Deps = { reader: PlaybackSettingsReader }

export const getPlaybackSettingsFactory =
  ({ reader }: Deps) =>
  (): PlaybackSettings =>
    reader.read()

export type GetPlaybackSettings = ReturnType<typeof getPlaybackSettingsFactory>
