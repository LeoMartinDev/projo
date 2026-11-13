import type { AccountRole } from '@projo/shared/api/auth'
import type { AvatarColor, UiLocale } from '@projo/shared/api/profiles'

import type { Account } from '../../../core/auth/account.ts'
import type { PasswordHasher } from '../../../core/auth/ports.ts'
import type { Clock } from '../../../core/clock.ts'
import type { IdGenerator } from '../../../core/ids.ts'
import { newProfile, type Profile } from '../../../core/profile/profile.ts'

export type NewAccountInput = {
  username: string
  password: string
  role: AccountRole
  uiLocale: UiLocale
  profileName?: string
  avatarColor?: AvatarColor
}

/** An account and its first profile, created by an admin or by accepting an invitation. */
export const buildNewAccount = async (
  {
    passwordHasher,
    ids,
    clock,
  }: { passwordHasher: PasswordHasher; ids: IdGenerator; clock: Clock },
  input: NewAccountInput,
): Promise<{ account: Account; profile: Profile }> => {
  const now = clock.now()
  const account: Account = {
    id: ids.next(),
    username: input.username,
    passwordHash: await passwordHasher.hash(input.password),
    role: input.role,
    createdAt: now,
  }
  const profile = newProfile({
    id: ids.next(),
    accountId: account.id,
    name: input.profileName ?? input.username,
    avatarColor: input.avatarColor ?? 'blue',
    uiLocale: input.uiLocale,
    createdAt: now,
  })
  return { account, profile }
}
