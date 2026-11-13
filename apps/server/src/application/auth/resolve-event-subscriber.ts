import type { AccountRepository } from '../../core/auth/account.ts'
import { type SessionRepository, sessionState } from '../../core/auth/session.ts'
import type { Clock } from '../../core/clock.ts'
import type { ProfileRepository } from '../../core/profile/profile.ts'
import { isRestricted } from '../../core/profile/restrictions.ts'

type Deps = {
  accountRepository: AccountRepository
  sessionRepository: SessionRepository
  profileRepository: ProfileRepository
  clock: Clock
}

export type EventSubscriber = {
  sessionId: string
  admin: boolean
}

export const resolveEventSubscriberFactory =
  ({ accountRepository, sessionRepository, profileRepository, clock }: Deps) =>
  (sessionId: string): EventSubscriber | undefined => {
    const session = sessionRepository.findById(sessionId)
    if (session === undefined || sessionState(session, clock.now()) !== 'active') return undefined
    const account = accountRepository.findById(session.accountId)
    if (account === undefined || account.disabledAt !== undefined) return undefined
    if (account.role !== 'admin') return { sessionId, admin: false }
    const profiles = profileRepository.listByAccount(account.id)
    const profile =
      profiles.length === 1
        ? profiles[0]
        : profiles.find((candidate) => candidate.id === session.lastProfileId)
    return { sessionId, admin: profile !== undefined && !isRestricted(profile) }
  }

export type ResolveEventSubscriber = ReturnType<typeof resolveEventSubscriberFactory>
