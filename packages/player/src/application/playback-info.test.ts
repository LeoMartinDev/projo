import { expect, test } from 'bun:test'

import { createFakePlaybackApi, sessionDto } from '../testing/fake-api.ts'
import { createFakeEngine } from '../testing/fake-engine.ts'
import { createManualTimers } from '../testing/manual-timers.ts'
import { type PlaybackInfoLive, watchPlaybackInfo } from './playback-info.ts'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const watch = (mode: 'direct' | 'hls_transcode', failTranscode = false) => {
  const { engine, commands } = createFakeEngine({ stats: { width: 1920, height: 1080 } })
  const { api, log } = createFakePlaybackApi({
    transcodeStatus: () => {
      if (failTranscode) throw new Error('offline')
      return { running: true, acceleration: 'gpu' }
    },
  })
  const manual = createManualTimers()
  const seen: PlaybackInfoLive[] = []
  const stop = watchPlaybackInfo({
    session: sessionDto('s1', { mode }),
    engine,
    api,
    timers: manual.timers,
    onChange: (live) => seen.push(live),
  })
  return { commands, log, manual, seen, stop }
}

test('reads the engine and the server run now, then every 2 s after the previous read', async () => {
  const { log, manual, seen, stop } = watch('hls_transcode')
  await flush()
  expect(seen).toEqual([
    { engine: { width: 1920, height: 1080 }, transcode: { running: true, acceleration: 'gpu' } },
  ])
  manual.advance(1999)
  await flush()
  expect(log).toEqual(['transcode s1'])
  manual.advance(1)
  await flush()
  expect(log).toEqual(['transcode s1', 'transcode s1'])
  expect(seen).toHaveLength(2)
  stop()
  expect(manual.count()).toBe(0)
})

test('a direct session never asks the server; a failed read leaves its part out', async () => {
  const direct = watch('direct')
  await flush()
  expect(direct.log).toEqual([])
  expect(direct.seen).toEqual([{ engine: { width: 1920, height: 1080 }, transcode: undefined }])
  direct.stop()

  const failing = watch('hls_transcode', true)
  await flush()
  expect(failing.seen).toEqual([{ engine: { width: 1920, height: 1080 }, transcode: undefined }])
  failing.stop()
})

test('nothing is reported once stopped, even a read in flight', async () => {
  const { seen, stop, manual } = watch('hls_transcode')
  stop()
  await flush()
  expect(seen).toEqual([])
  expect(manual.count()).toBe(0)
})
