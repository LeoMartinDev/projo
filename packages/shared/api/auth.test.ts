import { expect, test } from 'bun:test'

import { canAdminister, canManageAccount, type MeResponse } from './auth.ts'
import type { ProfileDto } from './profiles.ts'

const profile = (id: string, restricted = false): ProfileDto => ({
  id,
  name: id,
  avatarColor: 'blue',
  hasPin: false,
  uiLocale: 'fr',
  audioLanguage: 'fr',
  subtitleLanguage: 'fr',
  subtitleMode: 'when_audio_differs',
  animeOriginalAudio: true,
  autoplayNext: true,
  autoSkipIntro: false,
  autoSkipCredits: false,
  libraryAccess: 'all',
  libraryIds: [],
  ...(restricted ? { maxContentRating: '10' as const } : {}),
  createdAt: '2026-01-01T00:00:00.000Z',
})

const me = (activeProfileId?: string): MeResponse => ({
  account: { id: 'a', username: 'leo', role: 'admin' },
  profiles: [profile('adult'), profile('kid', true)],
  ...(activeProfileId === undefined ? {} : { activeProfileId }),
  needsProfileSelection: activeProfileId === undefined,
})

test('an unrestricted profile manages the account and administers', () => {
  expect(canManageAccount(me('adult'))).toBe(true)
  expect(canAdminister(me('adult'))).toBe(true)
})

test('a restricted profile does neither (§14)', () => {
  expect(canManageAccount(me('kid'))).toBe(false)
  expect(canAdminister(me('kid'))).toBe(false)
})

test('without an active profile, an account with a restricted profile acts as it', () => {
  expect(canManageAccount(me())).toBe(false)
  expect(canAdminister(me())).toBe(false)
})
