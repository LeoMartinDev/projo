export type PasswordHasher = {
  hash: (plain: string) => Promise<string>
  verify: (plain: string, hash: string) => Promise<boolean>
}

export type SessionTokens = {
  generate: () => string
  hash: (token: string) => string
}

export type RateLimiter = {
  blockedFor: (key: string) => number | undefined
  hit: (key: string) => void
  reset: (key: string) => void
}
