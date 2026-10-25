import { describe, expect, test } from 'bun:test'

import { contentRatingTiers } from '@projo/shared/api/profiles'

import { removesLastAdmin } from '../account/last-admin.ts'
import { invitationState } from '../invitation/invitation.ts'
import {
  allowedRatingsByCountry,
  allowedRatingsFor,
  ratingCountries,
  ratingTier,
  tierAge,
} from './content-rating.ts'
import { nextAvatarColor } from './profile.ts'
import {
  effectiveRestrictions,
  intersectionOf,
  isWithin,
  mayWiden,
  type ProfileRestrictions,
  unrestricted,
} from './restrictions.ts'
import { nothingVisible, visibilityScopeOf } from './visibility.ts'

const selected = (libraryIds: string[], maxContentRating?: '0' | '10' | '12' | '16' | '18') =>
  ({
    libraryAccess: 'selected',
    libraryIds,
    ...(maxContentRating === undefined ? {} : { maxContentRating }),
  }) satisfies ProfileRestrictions

describe('rating scales (§14)', () => {
  test('France: Tous publics, 10, 12, 16, 18', () => {
    expect(allowedRatingsFor('FR', '0')).toEqual(['U', 'TP'])
    expect(allowedRatingsFor('FR', '12')).toEqual(['U', 'TP', '10', '12'])
    expect(allowedRatingsFor('FR', '18')).toEqual(['U', 'TP', '10', '12', '16', '18'])
    expect(allowedRatingsFor('fr', '10')).toEqual(['U', 'TP', '10'])
  })

  test('United States: films and TV on the same age tiers', () => {
    expect(allowedRatingsFor('US', '12')).toEqual(['G', 'PG', 'TV-Y', 'TV-Y7', 'TV-G', 'TV-PG'])
    expect(allowedRatingsFor('US', '16')).toContain('PG-13')
    expect(allowedRatingsFor('US', '16')).toContain('TV-14')
    expect(allowedRatingsFor('US', '16')).not.toContain('R')
    expect(allowedRatingsFor('US', '18')).toEqual(expect.arrayContaining(['R', 'NC-17', 'TV-MA']))
  })

  test('neighbouring countries, unknown ratings and countries', () => {
    expect(allowedRatingsFor('DE', '12')).toEqual(['0', '6', '12'])
    expect(allowedRatingsFor('GB', '12')).toEqual(['U', 'PG', '12A', '12'])
    expect(allowedRatingsFor('GB', '16')).toContain('15')
    expect(allowedRatingsFor('CA', '16')).toEqual(['G', 'PG', '14A', 'C', 'C8', '14+'])
    expect(allowedRatingsFor('BE', '10')).toEqual(['AL', 'KT', '6', '9'])
    expect(allowedRatingsFor('CH', '0')).toEqual(['0'])
    expect(allowedRatingsFor('JP', '18')).toEqual([])
    // "Not rated" is never part of a scale: hidden as soon as a limit is set.
    for (const ratings of Object.values(allowedRatingsByCountry('18'))) {
      expect(ratings).not.toContain('NR')
      expect(ratings).not.toContain('')
    }
  })

  test('the tier of a rating is the lowest limit that shows it (badge, §13.5)', () => {
    expect(ratingTier('TP', 'FR')).toBe('0')
    expect(ratingTier('U', 'fr')).toBe('0')
    expect(ratingTier('12', 'FR')).toBe('12')
    expect(ratingTier('G', 'US')).toBe('0')
    expect(ratingTier('PG-13', 'US')).toBe('16')
    expect(ratingTier('R', 'US')).toBe('18')
    expect(ratingTier('6', 'DE')).toBe('10')
    expect(ratingTier('NR', 'US')).toBeUndefined()
    expect(ratingTier('12', 'JP')).toBeUndefined()
    for (const country of ratingCountries)
      for (const limit of contentRatingTiers)
        for (const rating of allowedRatingsFor(country, '18')) {
          const tier = ratingTier(rating, country)
          expect(tier !== undefined && tierAge(tier) <= tierAge(limit)).toBe(
            allowedRatingsFor(country, limit).includes(rating),
          )
        }
  })
})

describe('restrictions', () => {
  test('narrower or equal is within, wider is not', () => {
    expect(isWithin(selected(['a'], '12'), unrestricted)).toBe(true)
    expect(isWithin(selected(['a'], '12'), selected(['a', 'b'], '16'))).toBe(true)
    expect(isWithin(selected(['a', 'c'], '12'), selected(['a', 'b'], '16'))).toBe(false)
    expect(isWithin(selected(['a'], '18'), selected(['a'], '16'))).toBe(false)
    expect(isWithin(selected(['a']), selected(['a'], '16'))).toBe(false)
    expect(isWithin(unrestricted, selected(['a']))).toBe(false)
  })

  test('intersection: the libraries all see, the strictest tier, nothing without profile', () => {
    expect(intersectionOf([selected(['a', 'b'], '10'), selected(['a'], '16')])).toEqual(
      selected(['a'], '10'),
    )
    expect(intersectionOf([selected(['a'], '10'), unrestricted])).toEqual(selected(['a'], '10'))
    expect(intersectionOf([unrestricted, { ...unrestricted, maxContentRating: '12' }])).toEqual({
      ...unrestricted,
      maxContentRating: '12',
    })
    expect(intersectionOf([unrestricted, unrestricted])).toEqual(unrestricted)
    expect(intersectionOf([])).toEqual(selected([], '0'))
  })

  test('without a resolved active profile, an actor is the most restricted profile', () => {
    const kid = selected(['a'], '10')
    expect(
      effectiveRestrictions({ active: undefined, accountProfiles: [unrestricted, kid] }),
    ).toEqual(kid)
    expect(
      effectiveRestrictions({ active: unrestricted, accountProfiles: [unrestricted, kid] }),
    ).toEqual(unrestricted)
  })

  test('only an admin acting from a resolved unrestricted profile may widen', () => {
    expect(mayWiden({ role: 'admin', activeRestrictions: undefined })).toBe(false)
    expect(mayWiden({ role: 'admin', activeRestrictions: unrestricted })).toBe(true)
    expect(mayWiden({ role: 'admin', activeRestrictions: selected(['a']) })).toBe(false)
    expect(
      mayWiden({ role: 'admin', activeRestrictions: { ...unrestricted, maxContentRating: '10' } }),
    ).toBe(false)
    expect(mayWiden({ role: 'user', activeRestrictions: unrestricted })).toBe(false)
  })
})

describe('visibilityScopeOf', () => {
  test('unrestricted: everything', () => {
    expect(visibilityScopeOf(unrestricted)).toEqual({})
  })

  test('selected libraries and a tier', () => {
    const scope = visibilityScopeOf(selected(['a', 'b'], '12'))
    expect(scope.libraryIds).toEqual(['a', 'b'])
    expect(scope.allowedRatings?.['FR']).toEqual(['U', 'TP', '10', '12'])
    expect(scope.allowedRatings?.['US']).not.toContain('PG-13')
  })

  test('a tier alone keeps every library; nothing visible has no library', () => {
    expect(visibilityScopeOf({ ...unrestricted, maxContentRating: '0' }).libraryIds).toBeUndefined()
    expect(nothingVisible.libraryIds).toEqual([])
  })
})

describe('accounts and invitations', () => {
  test('the last enabled admin is protected', () => {
    expect(removesLastAdmin({ target: { role: 'admin' }, enabledAdmins: 1 })).toBe(true)
    expect(removesLastAdmin({ target: { role: 'admin' }, enabledAdmins: 2 })).toBe(false)
    expect(removesLastAdmin({ target: { role: 'user' }, enabledAdmins: 1 })).toBe(false)
    expect(
      removesLastAdmin({ target: { role: 'admin', disabledAt: new Date(0) }, enabledAdmins: 1 }),
    ).toBe(false)
  })

  test('invitation state', () => {
    const invitation = {
      id: 'i',
      tokenHash: 'h',
      createdBy: 'a',
      expiresAt: new Date('2026-01-08T00:00:00Z'),
    }
    expect(invitationState(invitation, new Date('2026-01-07T23:59:59Z'))).toBe('pending')
    expect(invitationState(invitation, new Date('2026-01-08T00:00:00Z'))).toBe('expired')
    expect(invitationState({ ...invitation, usedAt: new Date(0) }, new Date(0))).toBe('used')
  })

  test('avatar colours: the first unused one', () => {
    expect(nextAvatarColor([])).toBe('blue')
    expect(nextAvatarColor(['blue', 'terracotta'])).toBe('sage')
    expect(nextAvatarColor(['blue', 'terracotta', 'sage', 'violet', 'slate', 'honey'])).toBe('blue')
  })
})
