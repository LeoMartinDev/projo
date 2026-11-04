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

export const nextSession = (page: Page): Promise<PlaybackSessionDto> =>
  page.waitForResponse(isSessionCreation, { timeout: 30_000 }).then(async (response) => {
    expect(response.status(), `session: ${await response.text()}`).toBe(201)
    return (await response.json()) as PlaybackSessionDto
  })

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

export const openPlayer = async (page: Page, itemId: string): Promise<PlaybackSessionDto> => {
  const session = nextSession(page)
  await page.goto(`/watch/${itemId}?from=start`)
  return session
}

export const playerVideo = (page: Page) => page.locator('video')

export const expectPlayingPast = async (video: Locator, seconds: number, timeout = 30_000) =>
  expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime), {
      intervals: [100],
      timeout,
    })
    .toBeGreaterThan(seconds)

export const seekBar = (page: Page) => page.getByRole('slider', { name: fr.player.seek })

export const barSeconds = async (bar: Locator, attribute: 'aria-valuenow' | 'aria-valuemax') =>
  Number(await bar.getAttribute(attribute))

export const clickBarAt = async (page: Page, ratio: number) => {
  await wakePlayer(page)
  const bar = seekBar(page)
  const box = (await bar.boundingBox()) ?? undefined
  if (box === undefined) throw new Error('the playback bar has no box')
  await page.mouse.click(box.x + box.width * ratio, box.y + box.height / 2)
}

type LanguagesTab = 'audio' | 'subtitles'

export const showLanguagesTab = async (menu: Locator, tab: LanguagesTab) => {
  await expect(menu).toBeVisible()
  const own = menu.getByRole('tab', { name: fr.player.menu[tab], exact: true })
  if (await own.isVisible()) await own.click()
  return menu.getByRole('radiogroup', { name: fr.player.menu[tab], exact: true })
}

export const openLanguagesMenu = async (page: Page, tab: LanguagesTab) => {
  await wakePlayer(page)
  await page.getByRole('button', { name: fr.player.menu.title, exact: true }).click()
  return showLanguagesTab(page.getByRole('dialog', { name: fr.player.menu.title }), tab)
}

export const openQualityMenu = async (page: Page) => {
  await wakePlayer(page)
  await page.getByRole('button', { name: fr.player.menu.quality, exact: true }).click()
  const menu = page.getByRole('dialog', { name: fr.player.menu.quality })
  await expect(menu).toBeVisible()
  return menu
}

export const captions = (page: Page) => page.locator('.captions')

export const adminSessions = async (api: APIRequestContext) => {
  const response = await api.get('/api/v1/admin/playback/sessions')
  expect(response.ok(), `admin sessions: ${response.status()}`).toBe(true)
  return (await response.json()) as AdminPlaybackSessionDto[]
}
