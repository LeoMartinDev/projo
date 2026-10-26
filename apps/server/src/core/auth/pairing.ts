import { pairingCodeAlphabet, pairingCodeLength } from '@projo/shared/api/auth'

/**
 * §6.1 `pairings` (§14 "Pairing a device"): a short code shown by the web, claimed once by the
 * app for a bearer session of the same account. Only the code's hash is stored.
 */
export type Pairing = {
  id: string
  accountId: string
  createdBySessionId: string
  codeHash: string
  createdAt: Date
  expiresAt: Date
  claimedAt?: Date
  claimedSessionId?: string
}

export type PairingRepository = {
  create: (pairing: Pairing) => void
  /** The most recent pairing with this code hash (codes are reused once expired). */
  findByCodeHash: (codeHash: string) => Pairing | undefined
  /** Not claimed and not expired at `now`, voided ones included. */
  listLiveByAccount: (input: { accountId: string; now: Date }) => Pairing[]
  /** Marks it claimed unless it already is; `false` when another claim won. */
  claim: (input: { id: string; claimedAt: Date; claimedSessionId: string }) => boolean
  deleteExpiredBefore: (before: Date) => void
}

/** Random codes over the pairing alphabet, and their hash (§20: never stored in clear). */
export type PairingCodes = {
  generate: () => string
  hash: (code: string) => string
}

/** §24 "Pairing code": 5 minutes, 3 live per account. */
export const pairingLifetimeMs = 5 * 60_000
export const maxLivePairingsPerAccount = 3
/** Expired pairings are kept this long, then deleted when a new code is created. */
export const pairingRetentionMs = 24 * 60 * 60_000

/** A typed-in code as stored: upper case, without spaces or dashes ("k7m 4px" → "K7M4PX"). */
export const normalizePairingCode = (code: string): string =>
  code.replace(/[\s-]/g, '').toUpperCase()

const codePattern = new RegExp(`^[${pairingCodeAlphabet}]{${pairingCodeLength}}$`)

export const isWellFormedPairingCode = (code: string): boolean => codePattern.test(code)

/**
 * `voided`: the session that created it is no longer active (revoked, expired: §14 "revoking the
 * session that created it voids it").
 */
export type PairingState = 'live' | 'claimed' | 'expired' | 'voided'

export const pairingState = (
  pairing: Pairing,
  { now, creatorActive }: { now: Date; creatorActive: boolean },
): PairingState => {
  if (pairing.claimedAt !== undefined) return 'claimed'
  if (pairing.expiresAt.getTime() <= now.getTime()) return 'expired'
  if (!creatorActive) return 'voided'
  return 'live'
}
