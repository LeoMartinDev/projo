import { pairingCodeAlphabet, pairingCodeLength } from '@projo/shared/api/auth'

import type { PairingCodes } from '../../core/auth/pairing.ts'

export const pairingCodes: PairingCodes = {
  generate: () =>
    Array.from(
      crypto.getRandomValues(new Uint8Array(pairingCodeLength)),
      (byte) => pairingCodeAlphabet[byte % pairingCodeAlphabet.length],
    ).join(''),
  hash: (code) => new Bun.CryptoHasher('sha256').update(code).digest('hex'),
}
