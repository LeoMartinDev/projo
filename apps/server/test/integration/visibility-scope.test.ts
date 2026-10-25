import { beforeEach, describe, expect, test } from 'bun:test'

import { eq } from 'drizzle-orm'

import { visibilityScopeFactory } from '../../src/application/profile/visibility-scope.ts'
import type { VisibilityScope } from '../../src/core/catalog/catalog.ts'
import type { Db } from '../../src/infrastructure/sqlite/database.ts'
import { createSqliteAccountRepository } from '../../src/infrastructure/sqlite/account-repository.ts'
import { createSqliteProfileRepository } from '../../src/infrastructure/sqlite/profile-repository.ts'
import { libraries } from '../../src/infrastructure/sqlite/schema/libraries.ts'
import { sampleAccount, sampleProfile } from '../support/auth.ts'
import { insertLibrary } from '../support/catalog-fixtures.ts'
import { createManualClock } from '../support/clock.ts'
import { createTestDatabase } from '../support/database.ts'

/**
 * The §14 rule as `VisibilityScope` states it (what the catalogue applies): a library outside
 * `libraryIds`, or a rating not listed for the library's country, does not exist for the profile.
 */
const sees = (
  scope: VisibilityScope,
  item: { libraryId: string; country: string; rating?: string },
): boolean =>
  (scope.libraryIds === undefined || scope.libraryIds.includes(item.libraryId)) &&
  (scope.allowedRatings === undefined ||
    (item.rating !== undefined && (scope.allowedRatings[item.country] ?? []).includes(item.rating)))

let db: Db
let profiles: ReturnType<typeof createSqliteProfileRepository>

beforeEach(() => {
  db = createTestDatabase()
  profiles = createSqliteProfileRepository({ db })
  insertLibrary(db, { id: 'films', rootPath: '/films' })
  insertLibrary(db, { id: 'anime', rootPath: '/anime' })
  createSqliteAccountRepository({ db }).create({
    account: sampleAccount(),
    profile: sampleProfile(),
  })
})

describe('visibility scope of a profile (SQLite)', () => {
  test('unrestricted profile: everything', () => {
    const { resolve } = visibilityScopeFactory({
      profileRepository: profiles,
      clock: createManualClock(),
    })
    expect(resolve('profile-1')).toEqual({})
  })

  test('selected libraries and the French tier 12; unknown ratings are hidden', () => {
    profiles.create(
      sampleProfile({
        id: 'kid',
        libraryAccess: 'selected',
        libraryIds: ['anime'],
        maxContentRating: '12',
      }),
      { maxPerAccount: 5 },
    )
    const scope = visibilityScopeFactory({
      profileRepository: profiles,
      clock: createManualClock(),
    }).resolve('kid')
    expect(scope.libraryIds).toEqual(['anime'])

    const anime = { libraryId: 'anime', country: 'FR' }
    expect(sees(scope, { ...anime, rating: 'U' })).toBe(true)
    expect(sees(scope, { ...anime, rating: '12' })).toBe(true)
    expect(sees(scope, { ...anime, rating: '16' })).toBe(false)
    expect(sees(scope, { ...anime, rating: 'NR' })).toBe(false)
    expect(sees(scope, anime)).toBe(false)
    expect(sees(scope, { libraryId: 'films', country: 'FR', rating: 'U' })).toBe(false)
    // Another country's scale applies to a library rated there.
    expect(sees(scope, { libraryId: 'anime', country: 'US', rating: 'PG' })).toBe(true)
    expect(sees(scope, { libraryId: 'anime', country: 'US', rating: 'PG-13' })).toBe(false)
    expect(sees(scope, { libraryId: 'anime', country: 'JP', rating: 'G' })).toBe(false)
  })

  test('a deleted library vanishes from the selection; an unknown profile sees nothing', () => {
    profiles.create(
      sampleProfile({ id: 'kid', libraryAccess: 'selected', libraryIds: ['anime', 'films'] }),
      { maxPerAccount: 5 },
    )
    db.delete(libraries).where(eq(libraries.id, 'films')).run()
    const { resolve } = visibilityScopeFactory({
      profileRepository: profiles,
      clock: createManualClock(),
    })
    expect(resolve('kid')).toEqual({ libraryIds: ['anime'] })
    expect(sees(resolve('ghost'), { libraryId: 'anime', country: 'FR', rating: 'U' })).toBe(false)
  })
})
