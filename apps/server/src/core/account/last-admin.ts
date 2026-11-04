import type { Account } from '../auth/account.ts'
import { isRestricted, type ProfileRestrictions } from '../profile/restrictions.ts'

export const removesLastAdmin = ({
  target,
  enabledAdmins,
}: {
  target: Pick<Account, 'role' | 'disabledAt'>
  enabledAdmins: number
}): boolean => target.role === 'admin' && target.disabledAt === undefined && enabledAdmins <= 1

const unrestrictedIn = (profiles: readonly ProfileRestrictions[]): boolean =>
  profiles.some((profile) => !isRestricted(profile))

export const removesLastUnrestricted = ({
  role,
  before,
  after,
}: {
  role: Account['role'] | undefined
  before: readonly ProfileRestrictions[]
  after: readonly ProfileRestrictions[]
}): boolean => role === 'admin' && unrestrictedIn(before) && !unrestrictedIn(after)
