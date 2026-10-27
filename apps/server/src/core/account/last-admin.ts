import type { Account } from '../auth/account.ts'
import { isRestricted, type ProfileRestrictions } from '../profile/restrictions.ts'

/**
 * §14 "an admin cannot demote themselves if they are the last admin": demoting, disabling or
 * deleting `target` would leave the server without an enabled admin.
 */
export const removesLastAdmin = ({
  target,
  enabledAdmins,
}: {
  target: Pick<Account, 'role' | 'disabledAt'>
  enabledAdmins: number
}): boolean => target.role === 'admin' && target.disabledAt === undefined && enabledAdmins <= 1

const unrestrictedIn = (profiles: readonly ProfileRestrictions[]): boolean =>
  profiles.some((profile) => !isRestricted(profile))

/**
 * §14: `/admin` needs an active unrestricted profile and only such a profile widens one, so an
 * admin account keeps at least one: narrowing or deleting its last would lock it out for good.
 * `before`/`after`: the account's profiles around the change.
 */
export const removesLastUnrestricted = ({
  role,
  before,
  after,
}: {
  role: Account['role'] | undefined
  before: readonly ProfileRestrictions[]
  after: readonly ProfileRestrictions[]
}): boolean => role === 'admin' && unrestrictedIn(before) && !unrestrictedIn(after)
