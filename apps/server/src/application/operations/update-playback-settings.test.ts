import { describe, expect, test } from 'bun:test'

import { createManualClock } from '../../../test/support/clock.ts'
import { silentLogger } from '../../../test/support/logger.ts'
import { t0 } from '../../../test/support/operations-fakes.ts'
import type { PlaybackSettings } from '../../core/settings/settings.ts'
import { updatePlaybackSettingsFactory } from './update-playback-settings.ts'

describe('settings "Lecture" and "Serveur" (§15)', () => {
  test('playback: writes only what is given, reads back the result', () => {
    let stored: PlaybackSettings = {
      audioDownmix: 'stereo',
      maxConcurrentTranscodes: 2,
      transcodeCacheMaxGb: 10,
      burnInEnabled: true,
      trickplayEnabled: true,
      hwAccel: 'off',
    }
    const writes: unknown[] = []
    const update = updatePlaybackSettingsFactory({
      reader: { read: () => stored },
      writer: {
        write: ({ values }) => {
          writes.push(values)
          stored = { ...stored, ...values }
        },
      },
      clock: createManualClock(t0),
      logger: silentLogger,
    })
    expect(update({ maxConcurrentTranscodes: 4, audioDownmix: 'keep' })).toEqual({
      audioDownmix: 'keep',
      maxConcurrentTranscodes: 4,
      transcodeCacheMaxGb: 10,
      burnInEnabled: true,
      trickplayEnabled: true,
      hwAccel: 'off',
    })
    update({})
    expect(writes).toEqual([{ maxConcurrentTranscodes: 4, audioDownmix: 'keep' }])
  })
})
