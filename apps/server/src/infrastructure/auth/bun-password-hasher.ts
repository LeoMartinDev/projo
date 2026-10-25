import type { PasswordHasher } from '../../core/auth/ports.ts'

type Options = {
  /** KiB. Bun's default (64 MiB) in production; tests may lower it. */
  memoryCost?: number
  timeCost?: number
}

/** argon2id via `Bun.password` (§14, §20). A malformed stored hash verifies as `false`. */
export const createBunPasswordHasher = ({ memoryCost, timeCost }: Options = {}): PasswordHasher => {
  const options = {
    algorithm: 'argon2id' as const,
    ...(memoryCost === undefined ? {} : { memoryCost }),
    ...(timeCost === undefined ? {} : { timeCost }),
  }
  return {
    hash: (plain) => Bun.password.hash(plain, options),
    verify: async (plain, hash) => {
      try {
        return await Bun.password.verify(plain, hash)
      } catch {
        return false
      }
    },
  }
}
