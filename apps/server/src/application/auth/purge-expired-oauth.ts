import { oauthLifetimes, type OAuthRepository } from '../../core/auth/oauth.ts'
import type { Clock } from '../../core/clock.ts'

type Deps = {
  oauthRepository: Pick<OAuthRepository, 'purge'>
  clock: Clock
}

export const purgeExpiredOAuthFactory =
  ({ oauthRepository, clock }: Deps) =>
  (): void => {
    const now = clock.now()
    oauthRepository.purge({
      now,
      unusedBefore: new Date(now.getTime() - oauthLifetimes.unusedRegistrationMs),
    })
  }

export type PurgeExpiredOAuth = ReturnType<typeof purgeExpiredOAuthFactory>
