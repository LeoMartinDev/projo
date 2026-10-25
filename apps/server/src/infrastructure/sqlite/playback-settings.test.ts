import { expect, test } from 'bun:test'

import { defaultPlaybackSettings, settingKeys } from '../../core/settings/settings.ts'
import { createTestDatabase } from '../../../test/support/database.ts'
import { createSqlitePlaybackSettings } from './playback-settings.ts'
import { settings } from './schema/ops.ts'

test('reads the defaults when nothing is stored', () => {
  expect(createSqlitePlaybackSettings({ db: createTestDatabase() }).read()).toEqual(
    defaultPlaybackSettings,
  )
})

test('reads stored values and ignores invalid ones', () => {
  const db = createTestDatabase()
  const at = '2026-10-23T00:00:00.000Z'
  db.insert(settings)
    .values([
      { key: settingKeys.maxConcurrentTranscodes, value: 4, updatedAt: at },
      { key: settingKeys.audioDownmix, value: 'surround', updatedAt: at },
      { key: settingKeys.burnInEnabled, value: false, updatedAt: at },
    ])
    .run()
  expect(createSqlitePlaybackSettings({ db }).read()).toEqual({
    ...defaultPlaybackSettings,
    maxConcurrentTranscodes: 4,
    burnInEnabled: false,
  })
})
