import type { AccountRole } from '@projo/shared/api/auth'

import type { Profile } from '../profile/profile.ts'
import type { AuthAccount } from './principal.ts'

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
  findByUsername: (username: string) => Account | undefined
  list: () => Account[]
  countEnabledAdmins: () => number
  create: (input: { account: Account; profile: Profile }) => 'created' | 'username_taken'
  setRole: (input: { id: string; role: AccountRole }) => void
  setDisabled: (input: { id: string; disabledAt: Date | undefined }) => void
  setPasswordHash: (input: { id: string; passwordHash: string }) => void
  delete: (id: string) => void
}

export const toAuthAccount = ({ id, username, role }: Account): AuthAccount => ({
  id,
  username,
  role,
})
