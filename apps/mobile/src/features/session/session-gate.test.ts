import { describe, expect, test } from 'bun:test'

import type { MeResponse } from '@projo/shared/api/auth'
import type { ProfileDto } from '@projo/shared/api/profiles'

import { failure } from '../../shared/api/failure.ts'
import { sessionGate } from './session-gate.ts'

const profile = (id: string, name: string): ProfileDto => ({
  id,
  name,
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
  createdAt: '2026-10-01T00:00:00.000Z',
})

const leo = profile('p1', 'Léo')
const kids = profile('p2', 'Kids')
const me = (activeProfileId?: string): MeResponse => ({
  account: { id: 'a1', username: 'leo', role: 'admin' },
  profiles: [leo, kids],
  ...(activeProfileId === undefined ? {} : { activeProfileId }),
  needsProfileSelection: activeProfileId === undefined,
})
const signedIn = { loaded: true, token: 't0k3n' }
const unreachable = failure('network', 'server unreachable')

describe('sessionGate', () => {
  test('waits for the Keychain', () => {
    expect(sessionGate({ stored: { loaded: false }, me: {}, switching: false })).toEqual({
      kind: 'loading',
    })
  })

  test('no token: signed out', () => {
    expect(sessionGate({ stored: { loaded: true }, me: {}, switching: false })).toEqual({
      kind: 'signed_out',
    })
  })

  test('a token being checked: still loading', () => {
    expect(sessionGate({ stored: signedIn, me: {}, switching: false })).toEqual({
      kind: 'loading',
    })
  })

  test('the account never read: an error to retry', () => {
    expect(sessionGate({ stored: signedIn, me: { error: unreachable }, switching: false })).toEqual(
      { kind: 'error', error: unreachable },
    )
  })

  test('a resolved profile: ready', () => {
    expect(sessionGate({ stored: signedIn, me: { data: me('p2') }, switching: false })).toEqual({
      kind: 'ready',
      me: me('p2'),
      profile: kids,
    })
  })

  test('a failed refresh keeps the last answer', () => {
    expect(
      sessionGate({
        stored: signedIn,
        me: { data: me('p1'), error: unreachable },
        switching: false,
      }),
    ).toMatchObject({ kind: 'ready', profile: leo })
  })

  test('no resolved profile: "Who\'s watching?", nothing to go back to', () => {
    expect(sessionGate({ stored: signedIn, me: { data: me() }, switching: false })).toEqual({
      kind: 'choosing',
      me: me(),
      switching: false,
    })
  })

  test('an active profile that is not in the list: "Who\'s watching?"', () => {
    const stale = { ...me('p1'), needsProfileSelection: false, activeProfileId: 'gone' }
    expect(sessionGate({ stored: signedIn, me: { data: stale }, switching: false })).toMatchObject({
      kind: 'choosing',
      switching: false,
    })
  })

  test('switching from a ready session: "Who\'s watching?", with a way back', () => {
    expect(sessionGate({ stored: signedIn, me: { data: me('p1') }, switching: true })).toEqual({
      kind: 'choosing',
      me: me('p1'),
      switching: true,
    })
  })

  test('a lost token wins over everything else', () => {
    expect(
      sessionGate({ stored: { loaded: true }, me: { data: me('p1') }, switching: true }),
    ).toEqual({ kind: 'signed_out' })
  })
})
