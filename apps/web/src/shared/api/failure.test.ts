import { expect, test } from 'bun:test'

import { apiFailure, isProfileLost } from './failure.ts'

test('isProfileLost: only refusals of the active profile, or none chosen', () => {
  const refusal = (code: 'profile/pin_required' | 'profile/forbidden', profileId: string) =>
    apiFailure(403, code, '', { profileId })
  expect(isProfileLost(refusal('profile/pin_required', 'a'), 'a')).toBe(true)
  expect(isProfileLost(refusal('profile/forbidden', 'a'), 'a')).toBe(true)
  expect(isProfileLost(apiFailure(400, 'profile/required', ''), undefined)).toBe(true)
  // A PIN asked to edit another profile (PATCH /profiles/:id) is the form's business.
  expect(isProfileLost(refusal('profile/pin_required', 'b'), 'a')).toBe(false)
  expect(isProfileLost(apiFailure(403, 'profile/invalid_pin', '', { profileId: 'a' }), 'a')).toBe(
    false,
  )
})
