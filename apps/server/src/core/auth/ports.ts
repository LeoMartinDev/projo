/** argon2id (§14, §20). Never log the plain value. */
export type PasswordHasher = {
  hash: (plain: string) => Promise<string>
  verify: (plain: string, hash: string) => Promise<boolean>
}

/** Opaque session / bearer tokens: random, shown once, stored as a hash (§20). */
export type SessionTokens = {
  generate: () => string
  hash: (token: string) => string
}

/** Sliding-window limiter: at most `limit` hits per key over `windowMs` (§20). */
export type RateLimiter = {
  /** `retryAfterMs` when the key is blocked, `undefined` when it may proceed. */
  blockedFor: (key: string) => number | undefined
  hit: (key: string) => void
  reset: (key: string) => void
}
