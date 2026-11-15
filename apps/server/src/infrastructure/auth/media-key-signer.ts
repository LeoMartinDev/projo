import { createHmac, timingSafeEqual } from 'node:crypto'

import type { MediaKeySigner } from '../../core/auth/media-key.ts'

/** HMAC-SHA256 under the server's secret, read on first use (`secret` is called once). */
export const createHmacMediaKeySigner = ({
  secret,
}: {
  secret: () => Uint8Array
}): MediaKeySigner => {
  let key: Uint8Array | undefined
  const sign = (message: string): string => {
    key ??= secret()
    return createHmac('sha256', key).update(message).digest('base64url')
  }
  return {
    sign,
    verify: ({ message, signature }) => {
      const expected = Buffer.from(sign(message))
      const given = Buffer.from(signature)
      return expected.length === given.length && timingSafeEqual(expected, given)
    },
  }
}
