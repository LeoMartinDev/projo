import type { Account } from '../auth/account.ts'
import type { Profile } from '../profile/profile.ts'
import type { SettingKey } from '../settings/settings.ts'

export type SetupRepository = {
  isCompleted: () => boolean
  complete: (input: {
    account: Account
    profile: Profile
    settings: Partial<Record<SettingKey, unknown>>
    at: Date
  }) => 'completed' | 'already_completed'
}
