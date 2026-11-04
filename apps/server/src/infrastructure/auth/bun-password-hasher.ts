import type { PasswordHasher } from '../../core/auth/ports.ts'
import { createLimiter } from '../rate-limit/concurrency-limiter.ts'

type Options = {
  memoryCost?: number
  timeCost?: number
}

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
