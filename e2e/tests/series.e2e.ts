import type { APIRequestContext, Page, Response } from '@playwright/test'

import type { ItemDetailDto } from '../../packages/shared/api/catalog.ts'
import type { PlaybackSessionDto } from '../../packages/shared/api/playback.ts'
import type { ItemSegmentsDto } from '../../packages/shared/api/segments.ts'
import { expect, test } from '../support/fixtures.ts'
import { fr, startsWith, tr } from '../support/i18n.ts'
import { currentTime } from '../support/media.ts'
import {
  captions,
  clickBarAt,
  expectPlayingPast,
  nextSession,
  nextSessionFor,
  openPlayer,
  openTracksMenu,
  showTracksTab,
  playerVideo,
  signInMember,
} from '../support/playback.ts'
import { seriesTimeline } from '../support/playback-library.ts'

/**
 * Journey 4 "Show" (§4, §12.4, §11, §23 M4): "Skip intro", the "Next episode"
 * countdown that starts the next episode, the tracks chosen on episode 1 kept on episode 2, "vu"
 * on entering the credits. "Brackenmoor" (`support/playback-library.ts`) is unknown to TMDB: its
 * segments come from the `Intro` and `Credits` chapters of its files only.
 */

const { intro, credits, durationS } = seriesTimeline

/** `GET /items/:id/segments` until the chapters of the file gave the intro and the credits. */
const expectChapterSegments = async (api: APIRequestContext, itemId: string) => {
  const segments = async () => {
    const response = await api.get(`/api/v1/items/${itemId}/segments`)
    if (!response.ok()) return []
    return ((await response.json()) as ItemSegmentsDto).segments
  }
  await expect
    .poll(async () => (await segments()).map((segment) => segment.type).toSorted(), {
      timeout: 60_000,
      intervals: [500],
    })
    .toEqual(['credits', 'intro'])
  const found = await segments()
  expect(found.find((segment) => segment.type === 'intro')).toMatchObject({
    origin: 'chapter',
    startMs: intro.startS * 1000,
    endMs: intro.endS * 1000,
  })
  const end = found.find((segment) => segment.type === 'credits')
  expect(end).toMatchObject({ origin: 'chapter', startMs: credits.startS * 1000 })
  expect(Math.abs((end?.endMs ?? 0) - credits.endS * 1000)).toBeLessThanOrEqual(500)
}

const selectedAudio = (session: PlaybackSessionDto) =>
  session.audioTracks.find((track) => track.index === session.selectedAudioStreamIndex)

const selectedSubtitle = (session: PlaybackSessionDto) =>
  session.subtitleTracks.find((track) => track.id === session.selectedSubtitleTrackId)

const isTrackMemoryWrite = (itemId: string) => (response: Response) =>
  response.request().method() === 'PUT' &&
  response.url().endsWith(`/items/${itemId}/track-preferences`)

const skipIntroButton = (page: Page) => page.getByRole('button', { name: fr.player.skip.intro })

test('series: skip the intro, the countdown starts episode 2 with the tracks of episode 1', async ({
  page,
  adminRequest,
  playbackLibrary,
}) => {
  await signInMember(page, adminRequest, 'Lina')
  const video = playerVideo(page)
  const first = playbackLibrary.seriesEpisode1.itemId
  const second = playbackLibrary.seriesEpisode2.itemId

  await test.step('the chapters of both files give an intro and credits', async () => {
    await expectChapterSegments(page.request, first)
    await expectChapterSegments(page.request, second)
  })

  await test.step('"Passer l’intro" shows during the intro and jumps past its end', async () => {
    const session = await openPlayer(page, first)
    expect(session.segments.map((segment) => segment.type).toSorted()).toEqual(['credits', 'intro'])
    // French audio for a French profile: no subtitles (§11.2).
    expect(selectedAudio(session)?.language).toBe('fr')
    expect(selectedSubtitle(session)).toBeUndefined()
    await expect(skipIntroButton(page)).toBeVisible({ timeout: 20_000 })
    const before = await currentTime(video)
    expect(before).toBeGreaterThanOrEqual(intro.startS - 0.5)
    expect(before).toBeLessThan(intro.endS - 2)
    await skipIntroButton(page).click()
    await expectPlayingPast(video, intro.endS - 0.1, 10_000)
    expect(await currentTime(video)).toBeLessThan(intro.endS + 3)
    await expect(skipIntroButton(page)).toBeHidden()
  })

  await test.step('English subtitles, then English audio, from the menu', async () => {
    const subtitles = await openTracksMenu(page, 'subtitles')
    const subtitlesSaved = page.waitForResponse(isTrackMemoryWrite(first))
    const englishSubtitles = subtitles.getByRole('radio', { name: /^anglais/i })
    await englishSubtitles.click()
    await expect(englishSubtitles).toHaveAttribute('aria-checked', 'true')
    expect((await subtitlesSaved).ok()).toBe(true)

    const menu = page.getByRole('dialog', { name: fr.player.menu.title })
    const audio = await showTracksTab(menu, 'audio')
    const audioSaved = page.waitForResponse(isTrackMemoryWrite(first))
    const switched = nextSession(page)
    await audio.getByRole('radio', { name: /^anglais/i }).click()
    const session = await switched
    expect((await audioSaved).ok()).toBe(true)
    expect(session.itemId).toBe(first)
    expect(selectedAudio(session)?.language).toBe('en')
    // An audio change keeps the subtitles picked in this playback.
    expect(selectedSubtitle(session)).toMatchObject({ language: 'en', origin: 'embedded' })
    // The new session closes the menu (Escape now would leave the player).
    await expect(menu).toBeHidden()
    await expect(captions(page)).toHaveText('Brackenmoor English line 1', { timeout: 20_000 })
  })

  await test.step('into the credits: "Épisode suivant" counts down, then episode 2 starts', async () => {
    const next = nextSessionFor(page, second, 45_000)
    await clickBarAt(page, (credits.startS + 0.5) / durationS)
    const countdown = page.getByRole('button', { name: startsWith(fr.player.next.playIn) })
    await expect(countdown).toBeVisible({ timeout: 15_000 })
    const secondsOf = async () => Number(/\d+/.exec((await countdown.textContent()) ?? '')?.[0])
    const shown = await secondsOf()
    expect(shown).toBeGreaterThan(0)
    expect(shown).toBeLessThanOrEqual(10)
    await expect.poll(secondsOf, { timeout: 5_000 }).toBeLessThan(shown)

    const session = await next
    await expect(page).toHaveURL(new RegExp(`/watch/${second}`))
    await test.step('episode 2 keeps the English audio and subtitles of episode 1', async () => {
      expect(session.trackSelection).toBe('memory')
      expect(selectedAudio(session)?.language).toBe('en')
      expect(selectedSubtitle(session)).toMatchObject({ language: 'en', origin: 'embedded' })
      await expectPlayingPast(video, 0.5)
      await expect(captions(page)).toHaveText('Brackenmoor English line 2', { timeout: 20_000 })
    })
  })

  await test.step('episode 1 is marked watched: entering the credits counts as seen', async () => {
    const detail = async () => {
      const response = await page.request.get(`/api/v1/items/${first}`)
      expect(response.ok()).toBe(true)
      return (await response.json()) as ItemDetailDto
    }
    await expect.poll(async () => (await detail()).progress?.watched).toBe(true)
    const { title, episodeNumber, series } = await detail()
    if (series === undefined) throw new Error('an episode belongs to a series')
    await page.goto(`/items/${series.id}`)
    // Without a name of its own (§6.3), the episode is labelled from its number.
    const name = title ?? tr(fr.item.episodeNumber, { number: episodeNumber ?? 0 })
    await expect(
      page.getByRole('button', { name: tr(fr.item.markEpisodeUnwatched, { title: name }) }),
    ).toHaveAttribute('aria-pressed', 'true')
  })
})

test('series: with "auto skip intro", the intro is skipped once, "Annuler" goes back', async ({
  page,
  adminRequest,
  playbackLibrary,
}) => {
  await signInMember(page, adminRequest, 'Malo')
  const video = playerVideo(page)
  const { itemId } = playbackLibrary.seriesEpisode2
  await expectChapterSegments(page.request, itemId)

  const me = await page.request.get('/api/v1/auth/me')
  const { activeProfileId } = (await me.json()) as { activeProfileId?: string }
  const updated = await page.request.patch(`/api/v1/profiles/${activeProfileId ?? ''}`, {
    data: { autoSkipIntro: true },
  })
  expect(updated.ok(), `profile: ${await updated.text()}`).toBe(true)

  await openPlayer(page, itemId)
  const toast = page.getByRole('status').filter({ hasText: fr.player.skip.introSkipped })

  await test.step('at the start of the intro, a jump to its end and "Intro passée"', async () => {
    await expect(toast).toBeVisible({ timeout: 20_000 })
    await expectPlayingPast(video, intro.endS - 0.1, 5_000)
    await expect(skipIntroButton(page)).toBeHidden()
  })

  await test.step('"Annuler" goes back to the intro, which is not skipped again', async () => {
    await toast.getByRole('button', { name: fr.common.cancel }).click()
    await expect
      .poll(() => currentTime(video), { intervals: [100], timeout: 5_000 })
      .toBeLessThan(intro.startS + 2)
    await expect(toast).toBeHidden()
    await expectPlayingPast(video, intro.startS + 3)
    expect(await currentTime(video)).toBeLessThan(intro.endS)
    await expect(skipIntroButton(page)).toBeVisible()
  })
})
