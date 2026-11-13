import type { LoadPolicy } from 'hls.js'

import { KEYFRAME_WAIT_RETRIES } from '@projo/player/core/playlist-wait'

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
