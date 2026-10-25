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

/** What an SSE subscriber may receive right now (§17.1). */
export type EventSubscriber = {
  sessionId: string
  /** Admin events: admin role, from an unrestricted profile (§15). */
  admin: boolean
}

/**
 * Re-reads, at each event, who holds an SSE stream: a revoked or expired session, or a disabled
 * account, loses it (`undefined`); a demotion, or a switch to a restricted profile, stops the
 * admin events at once. The profile is the session's (the stream sends no `X-Profile-Id`): its
 * last profile, or the account's only one.
 */
export const eventSubscriberFactory =
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

export type CurrentEventSubscriber = ReturnType<typeof eventSubscriberFactory>
