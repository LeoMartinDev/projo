import type { Account } from '../auth/account.ts'

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
