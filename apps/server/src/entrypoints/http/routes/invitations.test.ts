import { describe, expect, test } from 'bun:test'

import { createAuthTestApp, sessionCookieOf } from '../../../../test/support/auth-app.ts'

type ErrorBody = { error: { code: string } }
const errorCode = async (response: Response) => ((await response.json()) as ErrorBody).error.code

const password = 'another long password'
const day = 24 * 3_600_000

const withAdmin = async () => {
  const t = createAuthTestApp()
  const { cookie } = await t.completeSetup()
  const admin = t.as(cookie)
  const invite = async () => {
    const response = await admin.send('POST', '/api/v1/admin/invitations')
    expect(response.status).toBe(201)
    return (await response.json()) as {
      token: string
      invitation: { id: string; state: string; expiresAt: string; createdBy: { username: string } }
    }
  }
  return { t, admin, invite }
}

describe('invitation journey (§4 parcours 2)', () => {
  test('create → check → accept → signed in on the first profile', async () => {
    const { t, admin, invite } = await withAdmin()
    const { token, invitation } = await invite()
    expect(invitation).toMatchObject({ state: 'pending', createdBy: { username: 'leo' } })
    expect(new Date(invitation.expiresAt).getTime() - t.clock.now().getTime()).toBe(7 * day)

    // Public: no cookie.
    const check = await t.request(`/api/v1/invitations/${token}`)
    expect(check.status).toBe(200)
    expect(await check.json()).toEqual({ expiresAt: invitation.expiresAt, serverName: 'Maison' })

    const accepted = await t.json('POST', `/api/v1/invitations/${token}/accept`, {
      username: 'zoe',
      password,
      uiLocale: 'en',
      profile: { name: 'Zoé', avatarColor: 'sage' },
    })
    expect(accepted.status).toBe(201)
    const me = (await accepted.json()) as {
      account: { username: string; role: string }
      profiles: { id: string; name: string; avatarColor: string; uiLocale: string }[]
      activeProfileId: string
      needsProfileSelection: boolean
    }
    expect(me.account).toMatchObject({ username: 'zoe', role: 'user' })
    expect(me.profiles).toEqual([
      expect.objectContaining({ name: 'Zoé', avatarColor: 'sage', uiLocale: 'en' }),
    ])
    expect(me.activeProfileId).toBe(me.profiles[0]?.id ?? '')
    expect(me.needsProfileSelection).toBe(false)

    const zoe = t.as(sessionCookieOf(accepted))
    expect((await zoe.get('/api/v1/auth/me')).status).toBe(200)
    expect((await t.login('zoe', password)).status).toBe(200)
    // A user is not an admin.
    expect((await zoe.send('POST', '/api/v1/admin/invitations')).status).toBe(403)

    const listed = (await (await admin.get('/api/v1/admin/invitations')).json()) as {
      items: { state: string; usedBy?: { username: string } }[]
    }
    expect(listed.items).toEqual([
      expect.objectContaining({
        state: 'used',
        usedBy: expect.objectContaining({ username: 'zoe' }),
      }),
    ])
  })

  test('single use', async () => {
    const { t, invite } = await withAdmin()
    const { token } = await invite()
    const body = { username: 'zoe', password }
    expect((await t.json('POST', `/api/v1/invitations/${token}/accept`, body)).status).toBe(201)
    const again = await t.json('POST', `/api/v1/invitations/${token}/accept`, {
      ...body,
      username: 'sam',
    })
    expect(again.status).toBe(410)
    expect(await errorCode(again)).toBe('auth/invitation_used')
    const check = await t.request(`/api/v1/invitations/${token}`)
    expect(check.status).toBe(410)
    expect(await errorCode(check)).toBe('auth/invitation_used')
  })

  test('expires after 7 days; unknown and withdrawn links are invalid', async () => {
    const { t, admin, invite } = await withAdmin()
    const { token } = await invite()
    const withdrawn = await invite()
    t.clock.advance(7 * day)
    const expired = await t.json('POST', `/api/v1/invitations/${token}/accept`, {
      username: 'zoe',
      password,
    })
    expect(expired.status).toBe(410)
    expect(await errorCode(expired)).toBe('auth/invitation_expired')
    expect((await t.request(`/api/v1/invitations/${token}`)).status).toBe(410)

    const unknown = await t.request('/api/v1/invitations/not-a-token')
    expect(unknown.status).toBe(404)
    expect(await errorCode(unknown)).toBe('auth/invitation_invalid')

    expect(
      (await admin.send('DELETE', `/api/v1/admin/invitations/${withdrawn.invitation.id}`)).status,
    ).toBe(204)
    expect((await t.request(`/api/v1/invitations/${withdrawn.token}`)).status).toBe(404)
    expect(
      (await admin.send('DELETE', `/api/v1/admin/invitations/${withdrawn.invitation.id}`)).status,
    ).toBe(404)
  })

  test('a taken username keeps the invitation usable', async () => {
    const { t, invite } = await withAdmin()
    const { token } = await invite()
    const taken = await t.json('POST', `/api/v1/invitations/${token}/accept`, {
      username: 'LEO',
      password,
    })
    expect(taken.status).toBe(409)
    expect(await errorCode(taken)).toBe('auth/username_taken')
    expect((await t.request(`/api/v1/invitations/${token}`)).status).toBe(200)
  })

  test('20 acceptance attempts per hour per IP (§20)', async () => {
    const { t } = await withAdmin()
    const attempt = () =>
      t.json('POST', '/api/v1/invitations/forged/accept', { username: 'zoe', password })
    for (let i = 0; i < 20; i += 1) expect((await attempt()).status).toBe(404)
    const blocked = await attempt()
    expect(blocked.status).toBe(429)
    expect(await errorCode(blocked)).toBe('auth/rate_limited')
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
    t.clock.advance(3_600_000)
    expect((await attempt()).status).toBe(404)
  })
})
