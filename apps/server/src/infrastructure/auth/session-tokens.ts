import type { SessionTokens } from '../../core/auth/ports.ts'

const tokenBytes = 32

export const sessionTokens: SessionTokens = {
  generate: () =>
    Buffer.from(crypto.getRandomValues(new Uint8Array(tokenBytes))).toString('base64url'),
  hash: (token) => new Bun.CryptoHasher('sha256').update(token).digest('hex'),
}
