import {
  type APIRequestContext,
  expect,
  type Locator,
  type Page,
  type Response,
  test,
} from '@playwright/test'

import type { LibraryDto, SourcesPage } from '../../packages/shared/api/libraries.ts'
import type {
  AdminPlaybackSessionDto,
  PlaybackSessionDto,
} from '../../packages/shared/api/playback.ts'
import { fr } from './i18n.ts'
import { wakePlayer } from './media.ts'
import {
  playbackFixtureCount,
  playbackFixtures,
  type PlaybackFixtureName,
} from './playback-library.ts'

export type PlaybackTarget = { itemId: string; sourceId: string }
export type PlaybackLibrary = Record<PlaybackFixtureName, PlaybackTarget>

const libraries = async (api: APIRequestContext): Promise<LibraryDto[]> => {
  const response = await api.get('/api/v1/admin/libraries')
  expect(response.ok(), `libraries: ${response.status()}`).toBe(true)
  return ((await response.json()) as { items: LibraryDto[] }).items
}

const libraryOf = async (api: APIRequestContext, root: string) =>
  (await libraries(api)).find((library) => library.roots.some(({ path }) => path === root))

/**
 * The "Playback" library (`playback-library.ts`), added by the first M3 journey of a server
 * (no quiet period: the files are complete), then reused. Waits for every source to be ready
 * and linked to its item. `api` is signed in as the admin.
 */
export const ensurePlaybackLibrary = async (
  api: APIRequestContext,
  root: string,
): Promise<PlaybackLibrary> => {
  if ((await libraryOf(api, root)) === undefined) {
    const created = await api.post('/api/v1/admin/libraries', {
      data: { name: 'Lecture', roots: [root], quietPeriodSeconds: 0 },
    })
    expect(created.status(), `playback library: ${await created.text()}`).toBe(201)
  }
  const library = await libraryOf(api, root)
  if (library === undefined) throw new Error(`no library on ${root}`)

  const sources = async () => {
    const response = await api.get('/api/v1/admin/sources', {
      params: { libraryId: library.id, state: 'ready', limit: 200 },
    })
    expect(response.ok(), `sources: ${response.status()}`).toBe(true)
    return ((await response.json()) as SourcesPage).items.filter(
      (source) => source.itemIds.length > 0,
    )
  }
  await expect
    .poll(async () => (await sources()).length, { timeout: 90_000, intervals: [500] })
    .toBe(playbackFixtureCount)

  const ready = await sources()
  const entries = (Object.keys(playbackFixtures) as PlaybackFixtureName[]).map((name) => {
    const source = ready.find(({ relativePath }) => relativePath === playbackFixtures[name].path)
    const itemId = source?.itemIds[0]
    if (source === undefined || itemId === undefined)
      throw new Error(`no ready source for ${playbackFixtures[name].path}`)
    return [name, { itemId, sourceId: source.id }] as const
  })
  return Object.fromEntries(entries) as PlaybackLibrary
}

/**
 * A member of the household with a single profile `profileName` (French interface, so French
 * audio and subtitles, `when_audio_differs`: the defaults of §11.1), signed in on `page`. Through
 * an invitation, which signs the new account in: logins are limited to 10 per 15 min per IP
 * (§20), invitations to 20 per hour. One per journey and project: every project runs on the
 * same server. `adminApi` is signed in as the admin.
 */
export const signInMember = async (
  page: Page,
  adminApi: APIRequestContext,
  profileName: string,
): Promise<void> => {
  const ascii = profileName
    .normalize('NFD')
    .replace(/[^A-Za-z]/g, '')
    .toLowerCase()
  const username = `${ascii}-${test.info().project.name}`.slice(0, 32)
  const created = await adminApi.post('/api/v1/admin/invitations')
  expect(created.status(), `invitation: ${await created.text()}`).toBe(201)
  const { token } = (await created.json()) as { token: string }
  const accepted = await page.request.post(`/api/v1/invitations/${token}/accept`, {
    data: { username, password: `${username}-e2e-password`, profile: { name: profileName } },
  })
  expect(accepted.status(), `account ${username}: ${await accepted.text()}`).toBe(201)
}

const isSessionCreation = (response: Response) =>
  response.request().method() === 'POST' &&
  new URL(response.url()).pathname === '/api/v1/playback/sessions'

/** The next `POST /playback/sessions` of `page`; call it before the action that sends it. */
export const nextSession = (page: Page): Promise<PlaybackSessionDto> =>
  page.waitForResponse(isSessionCreation, { timeout: 30_000 }).then(async (response) => {
    expect(response.status(), `session: ${await response.text()}`).toBe(201)
    return (await response.json()) as PlaybackSessionDto
  })

/**
 * The next `POST /playback/sessions` of `page` for `itemId` (other sessions, a track switch on
 * the current item, are let through); call it before the action that sends it.
 */
export const nextSessionFor = (
  page: Page,
  itemId: string,
  timeout = 30_000,
): Promise<PlaybackSessionDto> =>
  page
    .waitForResponse(
      (response) =>
        isSessionCreation(response) &&
        (response.request().postDataJSON() as { itemId?: string } | undefined)?.itemId === itemId,
      { timeout },
    )
    .then(async (response) => {
      expect(response.status(), `session: ${await response.text()}`).toBe(201)
      return (await response.json()) as PlaybackSessionDto
    })

/** Opens the player on `itemId` from the start; resolves with the session it created. */
export const openPlayer = async (page: Page, itemId: string): Promise<PlaybackSessionDto> => {
  const session = nextSession(page)
  await page.goto(`/watch/${itemId}?from=start`)
  return session
}

export const playerVideo = (page: Page) => page.locator('video')

/** `currentTime` of the stream (seconds), polled until it passes `seconds`. */
export const expectPlayingPast = async (video: Locator, seconds: number, timeout = 30_000) =>
  expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime), {
      intervals: [100],
      timeout,
    })
    .toBeGreaterThan(seconds)

/** The playback bar (`role=slider`), its values in seconds on the item timeline. */
export const seekBar = (page: Page) => page.getByRole('slider', { name: fr.player.seek })

export const barSeconds = async (bar: Locator, attribute: 'aria-valuenow' | 'aria-valuemax') =>
  Number(await bar.getAttribute(attribute))

/** Clicks the bar at `ratio` of its width (a seek on the item timeline). */
export const clickBarAt = async (page: Page, ratio: number) => {
  await wakePlayer(page)
  const bar = seekBar(page)
  const box = (await bar.boundingBox()) ?? undefined
  if (box === undefined) throw new Error('the playback bar has no box')
  await page.mouse.click(box.x + box.width * ratio, box.y + box.height / 2)
}

type LanguagesTab = 'audio' | 'subtitles'

/**
 * The list of radios of `tab` in the open "Subtitles and audio" menu: a column on wide screens, a
 * tab of its own (shown first) else.
 */
export const showLanguagesTab = async (menu: Locator, tab: LanguagesTab) => {
  await expect(menu).toBeVisible()
  const own = menu.getByRole('tab', { name: fr.player.menu[tab], exact: true })
  if (await own.isVisible()) await own.click()
  return menu.getByRole('radiogroup', { name: fr.player.menu[tab], exact: true })
}

/** Opens the "Subtitles and audio" menu on `tab` (see `showLanguagesTab`). */
export const openLanguagesMenu = async (page: Page, tab: LanguagesTab) => {
  await wakePlayer(page)
  await page.getByRole('button', { name: fr.player.menu.title, exact: true }).click()
  return showLanguagesTab(page.getByRole('dialog', { name: fr.player.menu.title }), tab)
}

/** Opens the quality menu (shown when the item has several qualities or versions). */
export const openQualityMenu = async (page: Page) => {
  await wakePlayer(page)
  await page.getByRole('button', { name: fr.player.menu.quality, exact: true }).click()
  const menu = page.getByRole('dialog', { name: fr.player.menu.quality })
  await expect(menu).toBeVisible()
  return menu
}

/** The subtitles drawn over the video by the player (`SubtitleOverlay`, hidden from ARIA). */
export const captions = (page: Page) => page.locator('.captions')

/** `GET /admin/playback/sessions`, `api` signed in as the admin. */
export const adminSessions = async (api: APIRequestContext) => {
  const response = await api.get('/api/v1/admin/playback/sessions')
  expect(response.ok(), `admin sessions: ${response.status()}`).toBe(true)
  return (await response.json()) as AdminPlaybackSessionDto[]
}
