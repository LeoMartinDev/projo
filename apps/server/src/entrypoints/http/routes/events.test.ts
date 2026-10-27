import { describe, expect, test } from 'bun:test'

import { createAuthTestApp, readUntil, sessionCookieOf } from '../../../../test/support/auth-app.ts'

const stats = { discovered: 3, pending: 0, ready: 3, missing: 0, errors: 0, seen: 3, moved: 0 }

const openStream = async (t: ReturnType<typeof createAuthTestApp>, cookie: string) => {
  const response = await t.request('/api/v1/events', { headers: { cookie } })
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toContain('text/event-stream')
  if (!response.body) throw new Error('no body')
  const reader = response.body.getReader()
  const state = { text: '' }
  await readUntil(reader, (text) => text.includes(': connected'), state)
  return { reader, state }
}

describe('GET /events (SSE)', () => {
  test('delivers published events by audience and unsubscribes on disconnect', async () => {
    const t = createAuthTestApp()
    const { cookie: adminCookie } = await t.completeSetup()
    const user = await t.addUser()
    const userLogin = await t.login(user.account.username, user.password)
    const userCookie = sessionCookieOf(userLogin)

    const admin = await openStream(t, adminCookie)
    const member = await openStream(t, userCookie)
    expect(t.activeSubscriptions()).toBe(2)

    t.eventBus.publish('scan.progress', {
      libraryId: 'lib-1',
      scanRunId: 'run-1',
      stats,
      phase: 'discovering',
    })
    t.eventBus.publish('playback.session_terminated', {
      playbackSessionId: 'play-1',
      sessionId: 'someone-else',
      reason: 'admin',
    })
    t.eventBus.publish('source.ready', { sourceId: 'src-1', libraryId: 'lib-1' })
    // Marker for the member: an event addressed to its own session.
    const memberSessions = await t.request('/api/v1/auth/sessions', {
      headers: { cookie: userCookie },
    })
    const { items } = (await memberSessions.json()) as { items: { id: string }[] }
    t.eventBus.publish('playback.session_terminated', {
      playbackSessionId: 'play-2',
      sessionId: items[0]?.id ?? '',
      reason: 'ended',
    })

    const adminText = (
      await readUntil(admin.reader, (text) => text.includes('source.ready'), admin.state)
    ).text
    expect(adminText).toContain(
      `event: scan.progress\ndata: ${JSON.stringify({ libraryId: 'lib-1', scanRunId: 'run-1', stats, phase: 'discovering' })}\n\n`,
    )
    expect(adminText).not.toContain('playback.session_terminated')

    expect(adminText).toContain(
      'event: source.ready\ndata: {"sourceId":"src-1","libraryId":"lib-1"}',
    )

    const memberText = (
      await readUntil(member.reader, (text) => text.includes('play-2'), member.state)
    ).text
    expect(memberText).not.toContain('scan.progress')
    expect(memberText).not.toContain('source.ready')

    await admin.reader.cancel()
    await member.reader.cancel()
    await Bun.sleep(5)
    expect(t.activeSubscriptions()).toBe(0)
  })

  test('owning_session events reach the session they name', async () => {
    const t = createAuthTestApp()
    const { cookie } = await t.completeSetup()
    const sessions = await t.request('/api/v1/auth/sessions', { headers: { cookie } })
    const { items } = (await sessions.json()) as { items: { id: string }[] }
    const stream = await openStream(t, cookie)

    t.eventBus.publish('playback.session_terminated', {
      playbackSessionId: 'play-1',
      sessionId: items[0]?.id ?? '',
      reason: 'timeout',
    })
    const { text } = await readUntil(
      stream.reader,
      (s) => s.includes('session_terminated'),
      stream.state,
    )
    expect(text).toContain('"reason":"timeout"')
    await stream.reader.cancel()
  })

  test('keep-alive comments, and the stream ends once the session is revoked', async () => {
    const t = createAuthTestApp({ keepAliveMs: 20 })
    const { cookie } = await t.completeSetup()
    const stream = await openStream(t, cookie)
    await readUntil(stream.reader, (text) => text.includes(': keep-alive'), stream.state)

    await t.request('/api/v1/auth/logout', { method: 'POST', headers: { cookie } })
    const end = await readUntil(stream.reader, () => false, stream.state)
    expect(end.done).toBe(true)
    expect(t.activeSubscriptions()).toBe(0)
  })

  test('admin events stop at once after a demotion or a switch to a restricted profile', async () => {
    const t = createAuthTestApp()
    const leo = t.as((await t.completeSetup()).cookie)
    const zoe = await t.addUser()
    expect(
      (await leo.send('PATCH', `/api/v1/admin/accounts/${zoe.account.id}`, { role: 'admin' }))
        .status,
    ).toBe(200)
    const zoeCookie = sessionCookieOf(await t.login('zoe', zoe.password))
    const stream = await openStream(t, zoeCookie)
    const publish = (scanRunId: string) =>
      t.eventBus.publish('scan.progress', {
        libraryId: 'lib-1',
        scanRunId,
        stats,
        phase: 'discovering',
      })
    publish('as-admin')
    await readUntil(stream.reader, (text) => text.includes('as-admin'), stream.state)

    expect(
      (await leo.send('PATCH', `/api/v1/admin/accounts/${zoe.account.id}`, { role: 'user' }))
        .status,
    ).toBe(200)
    publish('after-demotion')
    // Restricted while a user: an admin cannot narrow their last unrestricted profile.
    expect(
      (await leo.send('PATCH', `/api/v1/profiles/${zoe.profileId}`, { maxContentRating: '12' }))
        .status,
    ).toBe(200)
    // Back to admin, but on a restricted profile: still nothing.
    expect(
      (await leo.send('PATCH', `/api/v1/admin/accounts/${zoe.account.id}`, { role: 'admin' }))
        .status,
    ).toBe(200)
    publish('restricted')
    expect(
      (await leo.send('PATCH', `/api/v1/profiles/${zoe.profileId}`, { maxContentRating: '' }))
        .status,
    ).toBe(200)
    publish('unrestricted-again')
    const { text } = await readUntil(
      stream.reader,
      (s) => s.includes('unrestricted-again'),
      stream.state,
    )
    expect(text).not.toContain('after-demotion')
    expect(text).not.toContain('"restricted"')
    await stream.reader.cancel()
  })

  test('a disabled account loses its stream at the next event', async () => {
    const t = createAuthTestApp()
    const leo = t.as((await t.completeSetup()).cookie)
    const zoe = await t.addUser()
    const stream = await openStream(t, sessionCookieOf(await t.login('zoe', zoe.password)))
    expect(
      (await leo.send('PATCH', `/api/v1/admin/accounts/${zoe.account.id}`, { disabled: true }))
        .status,
    ).toBe(200)
    t.eventBus.publish('scan.progress', {
      libraryId: 'l',
      scanRunId: 'r',
      stats,
      phase: 'discovering',
    })
    expect((await readUntil(stream.reader, () => false, stream.state)).done).toBe(true)
  })

  test('module shutdown closes open streams', async () => {
    const t = createAuthTestApp()
    const { cookie } = await t.completeSetup()
    const stream = await openStream(t, cookie)
    t.stopEvents()
    expect((await readUntil(stream.reader, () => false, stream.state)).done).toBe(true)
  })
})
