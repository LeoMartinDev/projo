import { describe, expect, test } from 'bun:test'

import type { PlaybackSettingsDto } from '@projo/shared/api/settings'

import { changedFields } from './settings-draft.ts'
import { playbackChanges, type PlaybackDraft, playbackDraftOf } from './playback-form.ts'

const playback: PlaybackSettingsDto = {
  maxConcurrentTranscodes: 2,
  audioDownmix: 'stereo',
  burnInEnabled: true,
  transcodeCacheMaxGb: 50,
  trickplayEnabled: true,
  hwAccel: 'off',
  liveWindowMinutes: 30,
  liveCacheMaxGb: 20,
}

const saved = playbackDraftOf(playback)
const bodyOf = (edits: Partial<PlaybackDraft>) =>
  playbackChanges({ ...saved, ...edits }, changedFields(saved, edits))

describe('the Playback tab (§15)', () => {
  test('sends only what changed, switches as their stored values', () => {
    expect(bodyOf({ maxConcurrentTranscodes: '4', hwAccel: true, audioDownmix: false })).toEqual({
      ok: true,
      value: { playback: { maxConcurrentTranscodes: 4, hwAccel: 'vaapi', audioDownmix: 'keep' } },
    })
    expect(bodyOf({})).toEqual({ ok: true, value: { playback: {} } })
  })

  test('names the numbers out of bounds or not whole', () => {
    expect(bodyOf({ maxConcurrentTranscodes: '0', liveWindowMinutes: '1.5' })).toEqual({
      ok: false,
      error: ['maxConcurrentTranscodes', 'liveWindowMinutes'],
    })
    expect(bodyOf({ liveCacheMaxGb: '' })).toEqual({ ok: false, error: ['liveCacheMaxGb'] })
  })
})
