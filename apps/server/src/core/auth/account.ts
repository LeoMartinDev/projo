import type { AccountRole } from '@projo/shared/api/auth'

import type { Profile } from '../profile/profile.ts'
import type { AuthAccount } from './principal.ts'

/** §6.1 `accounts`. `passwordHash` is argon2id and never leaves the server. */
export type Account = {
  id: string
  username: string
  passwordHash: string
  role: AccountRole
  createdAt: Date
  disabledAt?: Date
}

export type AccountRepository = {
  findById: (id: string) => Account | undefined
  /** Case-insensitive (§6.1). */
  findByUsername: (username: string) => Account | undefined
  /** Oldest first. */
  list: () => Account[]
  /** Admins that are not disabled. */
  countEnabledAdmins: () => number
  /** Atomic: the account and its first profile, or nothing when the username is taken. */
  create: (input: { account: Account; profile: Profile }) => 'created' | 'username_taken'
  setRole: (input: { id: string; role: AccountRole }) => void
  /** `disabledAt` undefined: enabled again. */
  setDisabled: (input: { id: string; disabledAt: Date | undefined }) => void
  setPasswordHash: (input: { id: string; passwordHash: string }) => void
  /** Cascades to profiles, sessions, progress, lists, preferences (§6.1). */
  delete: (id: string) => void
}

export const toAuthAccount = ({ id, username, role }: Account): AuthAccount => ({
  id,
  username,
  role,
})
