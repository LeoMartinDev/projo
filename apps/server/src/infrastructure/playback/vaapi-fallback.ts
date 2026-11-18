import { accessSync, constants } from 'node:fs'

/**
 * Where a transcode runs (§10.3): `gpu` decodes, scales and encodes on the render node;
 * `gpu_encode` decodes on the CPU (a codec or profile the GPU cannot decode) and uploads the
 * frames to scale and encode them on the GPU; `software` is libx264. Shared by the playback
 * transcodes and the live `compat` streams (§29.4).
 */
export type Acceleration = 'gpu' | 'gpu_encode' | 'software'

export const firstAcceleration = ({
  wanted,
  nodeUsable,
  gpuDecodes,
}: {
  wanted: boolean
  nodeUsable: boolean
  gpuDecodes: boolean
}): Acceleration => (!wanted || !nodeUsable ? 'software' : gpuDecodes ? 'gpu' : 'gpu_encode')

/** A GPU run that failed before its first init: one step down, never back up. */
export const afterEarlyFailure = (acceleration: Acceleration): Acceleration =>
  acceleration === 'gpu' ? 'gpu_encode' : 'software'

/** A GPU run that failed by itself before writing its init steps its transcode down. */
export const fallsBack = (run: {
  acceleration: Acceleration
  exitCode: number
  killed: boolean
  initExists: boolean
}): boolean =>
  run.acceleration !== 'software' && !run.killed && run.exitCode !== 0 && !run.initExists

/** Codec and pixel format: what decides whether the GPU decodes a video (§10.3). */
export const decodeKeyOf = (video: { codec: string; pixelFormat?: string }): string =>
  `${video.codec}:${video.pixelFormat ?? 'unknown'}`

/** The render node exists and the process may read and write it. */
export const renderNodeUsable = (path: string): boolean => {
  try {
    accessSync(path, constants.R_OK | constants.W_OK)
    return true
  } catch {
    return false
  }
}
