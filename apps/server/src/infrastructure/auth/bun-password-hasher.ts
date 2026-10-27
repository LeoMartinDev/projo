import type { PasswordHasher } from '../../core/auth/ports.ts'
import { createLimiter } from '../rate-limit/concurrency-limiter.ts'

type Options = {
  /** KiB. Bun's default (64 MiB) in production; tests may lower it. */
  memoryCost?: number
  timeCost?: number
}

/**
 * argon2id via `Bun.password` (§14, §20). A malformed stored hash verifies as `false`.
 * One hash or verify at a time: each costs `memoryCost`, and the per-IP login limit does not
 * bound parallel attempts (§21: 300 MB).
 */
export const createBunPasswordHasher = ({ memoryCost, timeCost }: Options = {}): PasswordHasher => {
  const options = {
    algorithm: 'argon2id' as const,
    ...(memoryCost === undefined ? {} : { memoryCost }),
    ...(timeCost === undefined ? {} : { timeCost }),
  }
  const limit = createLimiter(1)
  return {
    hash: (plain) => limit(() => Bun.password.hash(plain, options)),
    verify: (plain, hash) =>
      limit(async () => {
        try {
          return await Bun.password.verify(plain, hash)
        } catch {
          return false
        }
      }),
  }
}
