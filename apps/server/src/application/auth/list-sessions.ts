import type { Session, SessionRepository } from '../../core/auth/session.ts'
import type { Clock } from '../../core/clock.ts'

type Deps = {
  sessionRepository: SessionRepository
  clock: Clock
}

export const listSessionsFactory =
  ({ sessionRepository, clock }: Deps) =>
  ({ accountId }: { accountId: string }): Session[] =>
    sessionRepository.listActiveByAccount({ accountId, now: clock.now() })

export type ListSessions = ReturnType<typeof listSessionsFactory>
