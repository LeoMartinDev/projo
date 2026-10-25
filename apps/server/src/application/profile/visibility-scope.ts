import type { VisibilityScope, VisibilityScopeResolver } from '../../core/catalog/catalog.ts'
import type { Clock } from '../../core/clock.ts'
import type { ProfileRepository } from '../../core/profile/profile.ts'
import { nothingVisible, visibilityScopeOf } from '../../core/profile/visibility.ts'

type Deps = {
  profileRepository: ProfileRepository
  clock: Clock
  /** How long a resolved scope is reused (profile edits invalidate it at once). */
  ttlMs?: number
}

/**
 * `VisibilityScopeResolver` of the catalogue (§14): what a profile sees, from its library access
 * and maximum rating. Called on every catalogue request, so scopes are cached briefly;
 * `invalidate` is called by every profile change. An unknown profile sees nothing.
 */
export const visibilityScopeFactory = ({ profileRepository, clock, ttlMs = 10_000 }: Deps) => {
  const cache = new Map<string, { scope: VisibilityScope; until: number }>()

  const resolve: VisibilityScopeResolver = (profileId) => {
    const now = clock.now().getTime()
    const cached = cache.get(profileId)
    if (cached !== undefined && cached.until > now) return cached.scope
    const profile = profileRepository.findById(profileId)
    const scope = profile === undefined ? nothingVisible : visibilityScopeOf(profile)
    if (cache.size > 1_000) cache.clear()
    cache.set(profileId, { scope, until: now + ttlMs })
    return scope
  }

  return {
    resolve,
    invalidate: (profileId: string) => {
      cache.delete(profileId)
    },
  }
}

export type VisibilityScopes = ReturnType<typeof visibilityScopeFactory>
