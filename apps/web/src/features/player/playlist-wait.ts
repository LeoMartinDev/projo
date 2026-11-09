import type { LoadPolicy } from 'hls.js'

export const KEYFRAME_WAIT_RETRIES = 15

export type PlaylistWait = 'ready' | 'cancelled'

export const waitForPlaylist = async ({
  status,
  delay,
  cancelled,
  retries = KEYFRAME_WAIT_RETRIES,
}: {
  status: () => Promise<number>
  delay: (ms: number) => Promise<void>
  cancelled: () => boolean
  retries?: number
}): Promise<PlaylistWait> => {
  for (let attempt = 0; ; attempt += 1) {
    const answer = await status()
    if (cancelled()) return 'cancelled'
    if (answer !== 503 || attempt >= retries) return 'ready'
    await delay(Math.min(1000 * 2 ** attempt, 2000))
    if (cancelled()) return 'cancelled'
  }
}

export const mediaPlaylistUrl = (streamUrl: string, base: string): string =>
  new URL('index.m3u8', new URL(streamUrl, base)).href

export const keyframeWaitLoadPolicy: LoadPolicy = {
  default: {
    maxTimeToFirstByteMs: Number.POSITIVE_INFINITY,
    maxLoadTimeMs: 30_000,
    timeoutRetry: { maxNumRetry: 2, retryDelayMs: 0, maxRetryDelayMs: 0 },
    errorRetry: {
      maxNumRetry: KEYFRAME_WAIT_RETRIES,
      retryDelayMs: 1000,
      maxRetryDelayMs: 2000,
      shouldRetry: (_config, retryCount, _isTimeout, response, retry) =>
        retry && (response?.code === 503 || retryCount < 1),
    },
  },
}
