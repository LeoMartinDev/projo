import { pairingCodeAlphabet, pairingCodeLength } from '@projo/shared/api/auth'

import type { PairingCodes } from '../../core/auth/pairing.ts'

/**
 * 6 characters drawn from the 32-character alphabet (§14): a random byte modulo 32 is uniform.
 * Stored as SHA-256 hex of the normalized code.
 */
export const pairingCodes: PairingCodes = {
  generate: () =>
    Array.from(
      crypto.getRandomValues(new Uint8Array(pairingCodeLength)),
      (byte) => pairingCodeAlphabet[byte % pairingCodeAlphabet.length],
    ).join(''),
  hash: (code) => new Bun.CryptoHasher('sha256').update(code).digest('hex'),
}
