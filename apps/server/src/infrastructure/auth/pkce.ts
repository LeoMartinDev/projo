import { timingSafeEqual } from 'node:crypto'

import type { PkceVerifier } from '../../core/auth/oauth.ts'

/** RFC 7636: 43 to 128 characters of `[A-Za-z0-9-._~]`. */
const verifierPattern = /^[A-Za-z0-9\-._~]{43,128}$/

/** PKCE S256 (§27.3): `BASE64URL(SHA256(verifier))`, compared in constant time. */
export const verifyPkceS256: PkceVerifier = ({ verifier, challenge }) => {
  if (!verifierPattern.test(verifier)) return false
  const computed = Buffer.from(new Bun.CryptoHasher('sha256').update(verifier).digest()).toString(
    'base64url',
  )
  const a = Buffer.from(computed)
  const b = Buffer.from(challenge)
  return a.length === b.length && timingSafeEqual(a, b)
}
