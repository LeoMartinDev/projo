import { expect, test } from 'bun:test'

import { toEngineStats } from './mpv-stats.ts'

test('a playing HEVC file decoded on the GPU', () => {
  expect(
    toEngineStats({
      'video-params': { w: 3840, h: 2160, pixelformat: 'p010', gamma: 'pq' },
      'video-format': 'hevc',
      'container-fps': 23.976,
      'hwdec-current': 'd3d11va',
      'frame-drop-count': 2,
      'decoder-frame-drop-count': 1,
      'audio-codec-name': 'truehd',
      'audio-params': { channels: '7.1', 'hr-channels': '7.1', 'channel-count': 8 },
    }),
  ).toEqual({
    width: 3840,
    height: 2160,
    frameRate: 23.976,
    videoCodec: 'hevc',
    audioCodec: 'truehd',
    audioChannels: '7.1',
    hardwareDecoding: 'd3d11va',
    droppedFrames: 3,
  })
})

test('nothing loaded yet: every property without a value, nothing reported', () => {
  expect(toEngineStats({})).toEqual({})
  expect(toEngineStats({ 'video-params': 'oops', 'container-fps': 0, 'video-format': '' })).toEqual(
    {},
  )
})

test('a software decode is reported as such', () => {
  expect(toEngineStats({ 'hwdec-current': 'no' })).toEqual({ hardwareDecoding: 'no' })
})
