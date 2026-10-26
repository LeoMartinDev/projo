import type { Response } from '@playwright/test'

import { expect, test } from '../support/fixtures.ts'
import { fr, matching, startsWith } from '../support/i18n.ts'
import { currentTime, playbackStart, wakePlayer } from '../support/media.ts'
import {
  adminSessions,
  barSeconds,
  captions,
  clickBarAt,
  expectPlayingPast,
  nextSession,
  openLanguagesMenu,
  openPlayer,
  openQualityMenu,
  playerVideo,
  seekBar,
  signInMember,
} from '../support/playback.ts'
import { englishCues, frenchCues } from '../support/playback-library.ts'

/**
 * Journey 3 and M3 "Complete playback" (§4, §10, §11, §23 M3): every file plays and resumes, with
 * the expected audio and subtitles without touching anything (timeline thumbnails: the server's
 * integration tests). Fixtures of the "Playback" library (`support/playback-library.ts`), one
 * household member per journey and project, French profile.
 */

const isSessionEnd = (sessionId: string) => (response: Response) =>
  response.request().method() === 'DELETE' &&
  new URL(response.url()).pathname === `/api/v1/playback/sessions/${sessionId}`

test(
  'movie: a MKV plays from its page, pauses, and "Resume" restarts near the position (§4 journey 3)',
  { tag: '@webkit' },
  async ({ page, browserName, adminRequest, playbackLibrary }) => {
    await signInMember(page, adminRequest, 'Hugo')
    const video = playerVideo(page)
    const title = 'Kestrel Dawn'
    let pausedAt = 0

    await test.step('play from the page, then pause and quit', async () => {
      await page.goto(`/items/${playbackLibrary.englishAudio.itemId}`)
      await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible()
      await page.getByRole('link', { name: fr.item.play, exact: true }).click()
      await expect(page).toHaveURL(/\/watch\//)
      await expectPlayingPast(video, 1)
      await wakePlayer(page)
      await page.getByRole('button', { name: fr.player.pause }).click()
      await expect(page.getByRole('button', { name: fr.player.play }).first()).toBeVisible()
      pausedAt = await currentTime(video)
      await page.getByRole('button', { name: fr.player.quit }).click()
    })

    await test.step('the page offers "Resume", playback restarts near the position', async () => {
      await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible()
      const session = nextSession(page)
      await page.getByRole('link', { name: startsWith(fr.item.resumeAt) }).click()
      const requestedAt = (await session).startPositionMs / 1000
      expect(requestedAt).toBeGreaterThanOrEqual(pausedAt - 0.5)
      expect(requestedAt).toBeLessThan(pausedAt + 1.5)
      // WebKit on Linux plays HLS through hls.js on GStreamer, which now and then never starts a
      // stream opened at a position (Safari plays HLS natively): the frames are checked on Chromium.
      if (browserName === 'webkit') return
      await expect
        .poll(() => playbackStart(video), { intervals: [50], timeout: 20_000 })
        .toBeGreaterThan(0)
      const resumedAt = await playbackStart(video)
      expect(resumedAt).toBeGreaterThanOrEqual(pausedAt - 0.5)
      expect(resumedAt).toBeLessThan(pausedAt + 1.5)
    })
  },
)

test('transcode: H.264 High 10 + AC-3 plays, progresses and seeks to the middle', async ({
  page,
  adminRequest,
  playbackLibrary,
}) => {
  await signInMember(page, adminRequest, 'Nadia')
  const video = playerVideo(page)

  await test.step('no browser decodes it: the session transcodes', async () => {
    const session = await openPlayer(page, playbackLibrary.transcode.itemId)
    expect(session.mode).toBe('hls_transcode')
    expect(session.stream.type).toBe('hls')
    await expectPlayingPast(video, 1)
  })

  await test.step('a seek to the middle of the bar resumes there', async () => {
    const total = await barSeconds(seekBar(page), 'aria-valuemax')
    expect(total).toBeGreaterThanOrEqual(29)
    await clickBarAt(page, 0.5)
    await expectPlayingPast(video, total / 2)
    const landed = await currentTime(video)
    expect(landed).toBeLessThan(total / 2 + 5)
    await expectPlayingPast(video, landed + 1)
  })
})

test(
  'cascade: French subtitles for English audio without touching anything, none for French audio',
  { tag: '@mobile' },
  async ({ page, adminRequest, playbackLibrary }) => {
    await signInMember(page, adminRequest, 'Inès')
    const video = playerVideo(page)

    await test.step('English audio: the French external SRT is selected and shown on time', async () => {
      const session = await openPlayer(page, playbackLibrary.englishAudio.itemId)
      expect(session.trackSelection).toBe('profile')
      const selected = session.subtitleTracks.find(
        (track) => track.id === session.selectedSubtitleTrackId,
      )
      expect(selected).toMatchObject({ origin: 'external', language: 'fr', delivery: 'vtt' })
      // The embedded English track is offered too, not chosen.
      expect(session.subtitleTracks.map((track) => track.language).toSorted()).toEqual(['en', 'fr'])

      // The second cue (4.5 s to 9 s): on screen while the video is inside it, never the English.
      const [, second] = frenchCues
      await expect(captions(page)).toHaveText(second.text, { timeout: 20_000 })
      const at = await currentTime(video)
      expect(at).toBeGreaterThanOrEqual(second.startS - 0.3)
      expect(at).toBeLessThanOrEqual(second.endS + 0.3)
      await expect(captions(page)).not.toContainText(englishCues[1].text)
    })

    await test.step('French audio: no subtitles', async () => {
      const session = await openPlayer(page, playbackLibrary.frenchAudio.itemId)
      expect(session.trackSelection).toBe('profile')
      expect(session.subtitleTracks.length).toBeGreaterThan(0)
      const selected = session.subtitleTracks.find(
        (track) => track.id === session.selectedSubtitleTrackId,
      )
      // Only a forced track would be allowed (§11.2); the file has none.
      expect(selected).toBeUndefined()
      await expectPlayingPast(video, frenchCues[1].startS + 0.5)
      await expect(captions(page)).toHaveCount(0)
    })
  },
)

test('memory: a subtitle change applies to the whole series, the next episode keeps it', async ({
  page,
  adminRequest,
  playbackLibrary,
}) => {
  await signInMember(page, adminRequest, 'Oscar')
  const video = playerVideo(page)

  await test.step('episode 1 opens with the French subtitles of the profile', async () => {
    const session = await openPlayer(page, playbackLibrary.episode1.itemId)
    expect(session.trackSelection).toBe('profile')
    expect(
      session.subtitleTracks.find((track) => track.id === session.selectedSubtitleTrackId),
    ).toMatchObject({ language: 'fr' })
    await expect(captions(page)).toHaveText(/épisode 1/, { timeout: 20_000 })
  })

  await test.step('switching to English from the menu: "Appliqué à toute la série"', async () => {
    const menu = await openLanguagesMenu(page, 'subtitles')
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        response.url().endsWith(`/items/${playbackLibrary.episode1.itemId}/track-preferences`),
    )
    const english = menu.getByRole('radio', { name: /^anglais/i })
    await english.click()
    await expect(english).toHaveAttribute('aria-checked', 'true')
    expect((await saved).ok()).toBe(true)
    await expect(
      page.getByRole('status').filter({ hasText: fr.player.memory.series }),
    ).toBeVisible()
    await expect(captions(page)).toHaveText('English line of episode 1')
  })

  await test.step('episode 2 opens with the English subtitles, from the memory', async () => {
    await page.keyboard.press('Escape')
    await wakePlayer(page)
    const next = nextSession(page)
    await page.getByRole('button', { name: fr.player.nextEpisode }).click()
    const session = await next
    expect(session.itemId).toBe(playbackLibrary.episode2.itemId)
    expect(session.trackSelection).toBe('memory')
    expect(
      session.subtitleTracks.find((track) => track.id === session.selectedSubtitleTrackId),
    ).toMatchObject({ language: 'en', origin: 'embedded' })
    await expectPlayingPast(video, 0.5)
    await expect(captions(page)).toHaveText('English line of episode 2', { timeout: 20_000 })
  })
})

test('quality: 480p from the menu transcodes at the same position, the old session ends', async ({
  page,
  adminRequest,
  playbackLibrary,
}) => {
  await signInMember(page, adminRequest, 'Paul')
  const video = playerVideo(page)

  const first = await openPlayer(page, playbackLibrary.quality.itemId)
  expect(first.mode).toBe('direct')
  expect(first.availableQualities).toEqual(['original', '480p'])
  await expectPlayingPast(video, 5)

  const menu = await openQualityMenu(page)
  const ended = page.waitForResponse(isSessionEnd(first.id))
  const next = nextSession(page)
  const before = await currentTime(video)
  await menu.getByRole('radio', { name: '480p' }).click()
  const second = await next

  expect(second.mode).toBe('hls_transcode')
  expect(second.quality).toBe('480p')
  expect(Math.abs(second.startPositionMs / 1000 - before)).toBeLessThanOrEqual(2)
  expect((await ended).ok()).toBe(true)

  await expectPlayingPast(video, 0)
  expect(Math.abs((await currentTime(video)) - before)).toBeLessThanOrEqual(2.5)
  await expectPlayingPast(video, before + 1)

  // The admin sees the new session only (§10.6).
  const ids = (await adminSessions(adminRequest)).map((session) => session.id)
  expect(ids).toContain(second.id)
  expect(ids).not.toContain(first.id)
})

test('parts: a movie in two parts shows their total and chains them without a click', async ({
  page,
  adminRequest,
  playbackLibrary,
}) => {
  await signInMember(page, adminRequest, 'Sami')
  const video = playerVideo(page)
  const bar = seekBar(page)

  const first = await openPlayer(page, playbackLibrary.partOne.itemId)
  expect(playbackLibrary.partTwo.itemId).toBe(playbackLibrary.partOne.itemId)
  expect(first.sourceId).toBe(playbackLibrary.partOne.sourceId)
  expect(first.parts.map((part) => part.sourceId)).toEqual([
    playbackLibrary.partOne.sourceId,
    playbackLibrary.partTwo.sourceId,
  ])
  const [partOne, partTwo] = first.parts
  if (partOne === undefined || partTwo === undefined) throw new Error('two parts expected')
  const totalMs = partOne.durationMs + partTwo.durationMs

  await test.step('the bar spans both parts', async () => {
    expect(Math.abs(totalMs - 16_000)).toBeLessThanOrEqual(1000)
    await expect(bar).toHaveAttribute('aria-valuemax', String(Math.round(totalMs / 1000)))
    await expectPlayingPast(video, 0.3)
  })

  await test.step('a seek near the end of part 1 goes on into part 2 by itself', async () => {
    const next = nextSession(page)
    await clickBarAt(page, (partOne.durationMs - 1500) / totalMs)
    const second = await next
    expect(second.sourceId).toBe(playbackLibrary.partTwo.sourceId)
    expect(second.partOffsetMs).toBe(partTwo.offsetMs)
    expect(second.startPositionMs).toBe(partTwo.offsetMs)
    await expectPlayingPast(video, 0.5)
    // Item timeline: part 1 + what part 2 played, on the same total.
    await expect
      .poll(() => barSeconds(bar, 'aria-valuenow'))
      .toBeGreaterThanOrEqual(Math.floor(partTwo.offsetMs / 1000))
    await expect(bar).toHaveAttribute('aria-valuemax', String(Math.round(totalMs / 1000)))
    const streamS = await currentTime(video)
    expect(streamS).toBeLessThan(partTwo.durationMs / 1000)
  })
})

test('admin sessions: the playback shows up in "Sessions actives", "Arrêter" stops it', async ({
  page,
  adminRequest,
  adminState,
  browser,
  playbackLibrary,
}) => {
  await signInMember(page, adminRequest, 'Tom')
  await openPlayer(page, playbackLibrary.englishAudio.itemId)
  await expectPlayingPast(playerVideo(page), 0.5)

  const adminContext = await browser.newContext({ storageState: adminState })
  const adminPage = await adminContext.newPage()
  await adminPage.goto('/admin')
  await adminPage
    .getByRole('navigation', { name: fr.admin.title })
    .getByRole('link', { name: fr.admin.sessions.title })
    .click()
  await expect(
    adminPage.getByRole('heading', { name: fr.admin.sessions.title, level: 1 }),
  ).toBeVisible()
  const row = adminPage
    .getByRole('table', { name: fr.admin.sessions.list })
    .getByRole('row')
    .filter({ hasText: 'Tom' })
  await expect(row).toHaveCount(1)
  await expect(row).toContainText(fr.admin.sessions.mode.hls_remux)

  await row.getByRole('button', { name: matching(fr.admin.sessions.stopNamed) }).click()
  await expect(page.getByRole('alert')).toContainText(fr.player.terminatedByAdmin)
  await expect(row).toHaveCount(0)
  await adminContext.close()
})
