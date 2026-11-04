import { pairingCodeAlphabet, pairingCodeLength } from '@projo/shared/api/auth'

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
  findByCodeHash: (codeHash: string) => Pairing | undefined
  listLiveByAccount: (input: { accountId: string; now: Date }) => Pairing[]
  claim: (input: { id: string; claimedAt: Date; claimedSessionId: string }) => boolean
  deleteExpiredBefore: (before: Date) => void
}

export type PairingCodes = {
  generate: () => string
  hash: (code: string) => string
}

export const pairingLifetimeMs = 5 * 60_000
export const maxLivePairingsPerAccount = 3
export const pairingRetentionMs = 24 * 60 * 60_000

export const normalizePairingCode = (code: string): string =>
  code.replace(/[\s-]/g, '').toUpperCase()

const codePattern = new RegExp(`^[${pairingCodeAlphabet}]{${pairingCodeLength}}$`)

export const isWellFormedPairingCode = (code: string): boolean => codePattern.test(code)

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
