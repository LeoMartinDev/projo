import type { SessionTokens } from '../../core/auth/ports.ts'

const tokenBytes = 32

/** 256-bit random tokens (base64url); stored as SHA-256 hex (§20). */
export const sessionTokens: SessionTokens = {
  generate: () =>
    Buffer.from(crypto.getRandomValues(new Uint8Array(tokenBytes))).toString('base64url'),
  hash: (token) => new Bun.CryptoHasher('sha256').update(token).digest('hex'),
}
