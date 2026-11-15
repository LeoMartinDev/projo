/**
 * A media key (§20) lets a client whose page cannot send a header on some loads (`<img>`,
 * `srcset`, CSS `url()`, a `<video>`) reach the media routes with its bearer session:
 * `<sessionId>.<base64url HMAC-SHA256(server secret, "media:" + sessionId)>`. It names the
 * session, so it dies with it (revocation, sign-out, expiry).
 */
export type MediaKeySigner = {
  /** base64url HMAC-SHA256 of the message under the server's secret. */
  sign: (message: string) => string
  /** Whether the signature is the message's, compared in constant time. */
  verify: (input: { message: string; signature: string }) => boolean
}

export const mediaKeyMessage = (sessionId: string): string => `media:${sessionId}`

export const formatMediaKey = ({
  sessionId,
  signature,
}: {
  sessionId: string
  signature: string
}): string => `${sessionId}.${signature}`

const maxMediaKeyLength = 256

export const parseMediaKey = (
  key: string,
): { sessionId: string; signature: string } | undefined => {
  if (key.length > maxMediaKeyLength) return undefined
  const [sessionId, signature, ...rest] = key.split('.')
  if (rest.length > 0 || !sessionId || !signature) return undefined
  return { sessionId, signature }
}
