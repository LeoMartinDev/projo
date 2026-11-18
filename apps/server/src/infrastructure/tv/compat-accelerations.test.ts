import { describe, expect, test } from 'bun:test'

import { createCapturingLogger } from '../../../test/support/logger.ts'
import type { LiveCompatSpec } from '../../core/tv/live.ts'
import { type CompatRunEnd, createCompatAccelerations } from './compat-accelerations.ts'

const spec = (channelId = 'a', pixelFormat = 'yuv420p10le'): LiveCompatSpec => ({
  channelId,
  run: 1,
  copyRun: 1,
  video: { codec: 'h264', pixelFormat, fieldOrder: 'tt' },
})

const failedEarly: CompatRunEnd = { exitCode: 1, killed: false, initExists: false, errorLines: '' }
const wroteInit: CompatRunEnd = { exitCode: 255, killed: true, initExists: true, errorLines: '' }

const world = ({ hwAccel = 'vaapi', usable = true } = {}) => {
  const { logger, lines } = createCapturingLogger()
  const notified: unknown[] = []
  const resolved: unknown[] = []
  const accelerations = createCompatAccelerations({
    logger,
    notifier: {
      notify: (input) => void notified.push(input),
      resolve: (input) => void resolved.push(input),
    },
    hwAccel: () => (hwAccel === 'vaapi' ? 'vaapi' : 'off'),
    renderNode: '/dev/dri/renderD128',
    nodeUsable: () => usable,
  })
  return { accelerations, lines, notified, resolved }
}

describe('compat accelerations: the VAAPI fallback of live compat streams (§29.4, §10.3)', () => {
  test('software when hw_accel is off; render node missing: software and notified', () => {
    expect(world({ hwAccel: 'off' }).accelerations.of(spec())).toBe('software')
    const missing = world({ usable: false })
    expect(missing.accelerations.of(spec())).toBe('software')
    expect(missing.notified).toEqual([
      expect.objectContaining({
        kind: 'playback/hw_accel_failed',
        key: 'vaapi',
        context: expect.objectContaining({ reason: 'render_node_unavailable' }),
      }),
    ])
  })

  test('an early GPU failure steps down: CPU decoding (info), then software (notified)', () => {
    const { accelerations, lines, notified } = world()
    expect(accelerations.of(spec())).toBe('gpu')
    accelerations.after(spec(), 'gpu', failedEarly)
    expect(accelerations.of(spec())).toBe('gpu_encode')
    expect(notified).toEqual([])
    expect(
      lines.filter((line) => line.fields['code'] === 'playback/hw_decode_unsupported'),
    ).toEqual([expect.objectContaining({ level: 'info' })])
    accelerations.after(spec(), 'gpu_encode', failedEarly)
    expect(accelerations.of(spec())).toBe('software')
    expect(notified).toEqual([
      expect.objectContaining({ context: expect.objectContaining({ reason: 'ffmpeg_failed' }) }),
    ])
    // Never back up while the stream lives; its next start chooses afresh.
    accelerations.after(spec(), 'software', failedEarly)
    expect(accelerations.of(spec())).toBe('software')
    accelerations.forget('a')
    expect(accelerations.of(spec())).toBe('gpu')
  })

  test('a run stopped on purpose, or once its init exists, steps nothing down', () => {
    const { accelerations } = world()
    accelerations.of(spec())
    accelerations.after(spec(), 'gpu', { ...failedEarly, killed: true })
    accelerations.after(spec(), 'gpu', { ...failedEarly, initExists: true })
    expect(accelerations.of(spec())).toBe('gpu')
  })

  test('a VAAPI run that writes its init resolves the notification; CPU decoding is remembered', () => {
    const { accelerations, resolved } = world()
    accelerations.of(spec('a'))
    accelerations.after(spec('a'), 'gpu', failedEarly)
    accelerations.after(spec('a'), 'gpu_encode', wroteInit)
    expect(resolved).toEqual([{ kind: 'playback/hw_accel_failed', key: 'vaapi' }])
    // Another channel of that codec and pixel format decodes on the CPU from its first run.
    expect(accelerations.of(spec('b'))).toBe('gpu_encode')
    expect(accelerations.of(spec('c', 'yuv420p'))).toBe('gpu')
    accelerations.after(spec('c', 'yuv420p'), 'gpu', wroteInit)
    expect(resolved).toHaveLength(2)
  })
})
