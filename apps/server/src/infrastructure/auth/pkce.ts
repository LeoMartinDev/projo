import { timingSafeEqual } from 'node:crypto'

import type { PkceVerifier } from '../../core/auth/oauth.ts'

const verifierPattern = /^[A-Za-z0-9\-._~]{43,128}$/

export const verifyPkceS256: PkceVerifier = ({ verifier, challenge }) => {
  if (!verifierPattern.test(verifier)) return false
  const computed = Buffer.from(new Bun.CryptoHasher('sha256').update(verifier).digest()).toString(
    'base64url',
  )
  const a = Buffer.from(computed)
  const b = Buffer.from(challenge)
  return a.length === b.length && timingSafeEqual(a, b)
}
