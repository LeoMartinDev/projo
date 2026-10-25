import type { Account } from '../auth/account.ts'
import type { Profile } from '../profile/profile.ts'
import type { SettingKey } from '../settings/settings.ts'

/** First launch (§15): writes the admin account, its first profile and the settings at once. */
export type SetupRepository = {
  isCompleted: () => boolean
  /** Atomic. `'already_completed'` when an account exists (nothing is written). */
  complete: (input: {
    account: Account
    profile: Profile
    settings: Partial<Record<SettingKey, unknown>>
    at: Date
  }) => 'completed' | 'already_completed'
}
