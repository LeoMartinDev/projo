import type { Logger } from '../../core/logger.ts'
import type { AdminNotifier } from '../../core/notifications/notifier.ts'
import type { LiveCompatSpec } from '../../core/tv/live.ts'
import {
  type Acceleration,
  afterEarlyFailure,
  decodeKeyOf,
  fallsBack,
  firstAcceleration,
  renderNodeUsable,
} from '../playback/vaapi-fallback.ts'

/** How a compat run ended, for the VAAPI fallback. */
export type CompatRunEnd = {
  exitCode: number
  /** Stopped on purpose: never a step down. */
  killed: boolean
  /** The run wrote its init: the GPU (or the CPU decoding) works for this video. */
  initExists: boolean
  errorLines: string
}

/**
 * Where each compat stream transcodes (§29.4, the rules of §10.3), in memory: chosen at its
 * first run (`settings.hw_accel`, the render node, the codecs and pixel formats seen to need
 * CPU decoding), stepped down after a VAAPI run that fails before its init (GPU decoding → CPU
 * decoding → software, never back up while the stream lives), forgotten with the stream. Its
 * memory of CPU decoding is the live streams' own, apart from the playback sessions'.
 */
export const createCompatAccelerations = ({
  logger,
  notifier,
  hwAccel,
  renderNode,
  nodeUsable = renderNodeUsable,
}: {
  logger: Logger
  notifier?: AdminNotifier
  /** `settings.hw_accel` (§10.3), read at each stream's first run. */
  hwAccel: () => 'off' | 'vaapi'
  renderNode: string
  nodeUsable?: (path: string) => boolean
}) => {
  const accelerations = new Map<string, Acceleration>()
  /** Codecs and pixel formats the GPU failed to decode but encoded once decoded on the CPU. */
  const cpuDecoded = new Set<string>()

  const vaapiFailed = (
    spec: LiveCompatSpec,
    reason: 'render_node_unavailable' | 'ffmpeg_failed',
    stderr?: string,
  ): void => {
    logger.warn('VAAPI unavailable, transcoding in software', {
      code: 'playback/hw_accel_failed',
      channelId: spec.channelId,
      reason,
      renderNode,
      ...(stderr === undefined ? {} : { stderr }),
    })
    notifier?.notify({
      kind: 'playback/hw_accel_failed',
      severity: 'warning',
      key: 'vaapi',
      context: { reason, renderNode, codec: spec.video.codec },
    })
  }

  return {
    /** Where the stream's next run transcodes. */
    of: (spec: LiveCompatSpec): Acceleration => {
      const known = accelerations.get(spec.channelId)
      if (known !== undefined) return known
      const wanted = hwAccel() === 'vaapi'
      const usable = wanted && nodeUsable(renderNode)
      if (wanted && !usable) vaapiFailed(spec, 'render_node_unavailable')
      const first = firstAcceleration({
        wanted,
        nodeUsable: usable,
        gpuDecodes: !cpuDecoded.has(decodeKeyOf(spec.video)),
      })
      accelerations.set(spec.channelId, first)
      return first
    },

    /** What a finished run says of the GPU: remembered, and a step down when it failed early. */
    after: (spec: LiveCompatSpec, acceleration: Acceleration, run: CompatRunEnd): void => {
      if (acceleration === 'software') return
      if (run.initExists) {
        notifier?.resolve({ kind: 'playback/hw_accel_failed', key: 'vaapi' })
        if (acceleration === 'gpu_encode') cpuDecoded.add(decodeKeyOf(spec.video))
      }
      if (!fallsBack({ acceleration, ...run })) return
      const next = afterEarlyFailure(acceleration)
      if (accelerations.has(spec.channelId)) accelerations.set(spec.channelId, next)
      if (next === 'software') {
        vaapiFailed(spec, 'ffmpeg_failed', run.errorLines)
        return
      }
      logger.info('the GPU cannot decode this channel, decoding it on the CPU', {
        code: 'playback/hw_decode_unsupported',
        channelId: spec.channelId,
        codec: spec.video.codec,
        pixelFormat: spec.video.pixelFormat,
        stderr: run.errorLines,
      })
    },

    /** The stream is gone: its next start chooses afresh. */
    forget: (channelId: string): void => {
      accelerations.delete(channelId)
    },
  }
}

export type CompatAccelerations = ReturnType<typeof createCompatAccelerations>
