import type { Page } from '@playwright/test'

import type { MeResponse } from '../../packages/shared/api/auth.ts'
import type { ItemDetailDto } from '../../packages/shared/api/catalog.ts'
import { expect, test } from '../support/fixtures.ts'
import { fr } from '../support/i18n.ts'
import { currentTime, wakePlayer } from '../support/media.ts'
import { expectPlayingPast, playerVideo, signInMember } from '../support/playback.ts'
import { seriesTimeline } from '../support/playback-library.ts'

const { intro } = seriesTimeline

type Focused = {
  label: string
  href: string | undefined
  role: string | undefined
  dialog: string | undefined
  keyboard: boolean
  still: boolean
  card: boolean
  // The home row it sits in (the id of its title).
  row: string | undefined
  primary: boolean
}

// The element with focus, as a keyboard user meets it.
const focused = (page: Page): Promise<Focused> =>
  page.evaluate(() => {
    const element = document.activeElement
    if (!(element instanceof HTMLElement))
      return {
        label: '',
        href: undefined,
        role: undefined,
        dialog: undefined,
        keyboard: false,
        still: false,
        card: false,
        row: undefined,
        primary: false,
      }
    return {
      label: element.getAttribute('aria-label') ?? element.textContent.trim(),
      href: element.getAttribute('href') ?? undefined,
      role: element.getAttribute('role') ?? undefined,
      dialog: element.closest('[role="dialog"]')?.getAttribute('aria-label') ?? undefined,
      keyboard: element.matches(':focus-visible'),
      still: element.matches('.episode__still'),
      card: element.matches('a.card'),
      row: element.closest('section.row')?.getAttribute('aria-labelledby') ?? undefined,
      primary: element.matches('[data-nav-primary]'),
    }
  })

const pressUntil = async (
  page: Page,
  key: string,
  reached: (element: Focused) => boolean,
  what: string,
  max = 40,
) => {
  for (let press = 0; press < max; press += 1) {
    await page.keyboard.press(key)
    if (reached(await focused(page))) return
  }
  throw new Error(`${key} never reached ${what} (now on "${(await focused(page)).label}")`)
}

test('keyboard only: profile, series, episode, skip the intro, subtitles, back to the episode (§19)', async ({
  page,
  adminRequest,
  playbackLibrary,
}) => {
  await signInMember(page, adminRequest, 'Iris')
  const video = playerVideo(page)
  const episode = playbackLibrary.seriesEpisode1.itemId
  const detail = (await (
    await page.request.get(`/api/v1/items/${episode}`)
  ).json()) as ItemDetailDto
  const series = detail.series
  const title = series?.title
  if (series === undefined || title === undefined) throw new Error('an episode belongs to a series')
  const isStill = (element: Focused) => element.still && element.href === `/watch/${episode}`

  await test.step('pick the profile, then find the series with search', async () => {
    await page.goto('/profiles')
    await pressUntil(page, 'Tab', (element) => element.label === 'Iris', 'the profile')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/$/)
    // The home took focus on its main region: the shortcuts of the page work at once.
    await expect(page.locator('#main')).toBeFocused()
  })

  await test.step('a home card opens its page; back, focus is on that card, ringed on its preview', async () => {
    const isCard = (element: Focused) =>
      element.card && (element.href ?? '').startsWith(`/items/${series.id}`)
    // One Tab stop per row (§19): Tab reaches the row holding the series, → its card.
    const inSeriesRow = () =>
      page.evaluate(
        (id) =>
          document.activeElement
            ?.closest('section.row')
            ?.querySelector(`a.card[href^="/items/${id}"]`) instanceof HTMLElement,
        series.id,
      )
    let found = false
    for (let press = 0; press < 40 && !found; press += 1) {
      await page.keyboard.press('Tab')
      found = await inSeriesRow()
    }
    if (!found) throw new Error('Tab never reached the row holding the series')
    if (!isCard(await focused(page)))
      await pressUntil(page, 'ArrowRight', isCard, 'the card of the series')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(new RegExp(`/items/${series.id}`))
    await expect(page.locator('.episode__still').first()).toBeVisible()
    await page.goBack()
    await expect(page).toHaveURL(/\/$/)
    await expect.poll(async () => isCard(await focused(page))).toBe(true)
    const ring = await page.evaluate(() => {
      const preview = document.activeElement?.closest('.cw')?.querySelector('.preview') ?? undefined
      if (preview === undefined) return ''
      const style = getComputedStyle(preview)
      return `${style.outlineStyle} ${style.outlineWidth}`
    })
    expect(ring).toBe('solid 3px')
  })

  await test.step('search finds the series', async () => {
    await page.keyboard.press('/')
    await expect(page.getByRole('combobox')).toBeFocused()
    await page.keyboard.type(title)
    await expect(page.getByRole('option', { name: new RegExp(title) })).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(new RegExp(`/items/${series.id}`))
    await expect(page.locator('.episode__still').first()).toBeVisible()
  })

  await test.step('the page takes focus: Tab goes on in it, to the first episode', async () => {
    await expect(page.locator('#main')).toBeFocused()
    await pressUntil(page, 'Tab', isStill, 'the still of episode 1')
    expect((await focused(page)).keyboard).toBe(true)
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(new RegExp(`/watch/${episode}`))
  })

  await test.step('"Passer l’intro" with Tab and Space: it skips, focus goes to play/pause', async () => {
    const skip = page.getByRole('button', { name: fr.player.skip.intro })
    await expect(skip).toBeVisible({ timeout: 20_000 })
    await pressUntil(page, 'Tab', (element) => element.label === fr.player.skip.intro, 'Skip', 10)
    await page.keyboard.press('Space')
    await expectPlayingPast(video, intro.endS - 0.1, 10_000)
    expect(await currentTime(video), 'Space skipped instead of pausing').toBeLessThan(
      intro.endS + 3,
    )
    await expect(skip).toBeHidden()
    await expect(page.getByRole('button', { name: fr.player.pause, exact: true })).toBeFocused()
    expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false)
  })

  await test.step('with focus on play/pause, the chrome still fades after the idle delay', async () => {
    await expect(page.locator('.player')).toHaveClass(/player--idle/, { timeout: 8_000 })
    await expect(page.getByRole('button', { name: fr.player.pause, exact: true })).toBeFocused()
  })

  await test.step('the volume slider reached with the keyboard keeps its arrows', async () => {
    await pressUntil(page, 'Tab', (element) => element.label === fr.player.volume, 'Volume', 10)
    const volume = () => video.evaluate((element: HTMLVideoElement) => element.volume)
    const before = await volume()
    const at = await currentTime(video)
    await page.keyboard.press('ArrowLeft')
    await expect.poll(volume).toBeLessThan(before)
    expect(
      await currentTime(video),
      'ArrowLeft changed the volume, not the position',
    ).toBeGreaterThan(at - 2)
  })

  await test.step('the subtitles and audio menu takes focus and holds it; ↑/↓ and Enter pick', async () => {
    const opener = page.getByRole('button', { name: fr.player.menu.title, exact: true })
    await pressUntil(page, 'Tab', (element) => element.label === fr.player.menu.title, 'the menu')
    await page.keyboard.press('Enter')
    const menu = page.getByRole('dialog', { name: fr.player.menu.title })
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('radio', { name: fr.player.menu.off })).toBeFocused()

    await pressUntil(
      page,
      'ArrowDown',
      (element) => element.role === 'radio' && /^anglais/i.test(element.label),
      'English subtitles',
      5,
    )
    await page.keyboard.press('Enter')
    const english = menu
      .getByRole('radiogroup', { name: fr.player.menu.subtitles, exact: true })
      .getByRole('radio', { name: /^anglais/i })
    await expect(english).toHaveAttribute('aria-checked', 'true')
    await expect(english).toBeFocused()

    for (let press = 0; press < 12; press += 1) {
      await page.keyboard.press(press % 3 === 2 ? 'Shift+Tab' : 'Tab')
      expect((await focused(page)).dialog, 'Tab stays in the menu').toBe(fr.player.menu.title)
    }

    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(opener).toBeFocused()
  })

  await test.step('the settings menu opens on the speed: ←/→ step it, ↓/↑ leave it and come back', async () => {
    const opener = page.getByRole('button', { name: fr.player.menu.settings, exact: true })
    await pressUntil(
      page,
      'Tab',
      (element) => element.label === fr.player.menu.settings,
      'the settings',
    )
    await page.keyboard.press('Enter')
    const menu = page.getByRole('dialog', { name: fr.player.menu.settings })
    await expect(menu).toBeVisible()
    const slider = menu.getByRole('slider')
    await expect(slider).toBeFocused()
    const rate = () => video.evaluate((element: HTMLVideoElement) => element.playbackRate)
    await page.keyboard.press('ArrowRight')
    await expect.poll(rate).toBe(1.5)
    await page.keyboard.press('ArrowLeft')
    await expect.poll(rate).toBe(1)
    await page.keyboard.press('ArrowDown')
    await expect(slider).not.toBeFocused()
    expect((await focused(page)).dialog, '↓ stays in the menu').toBe(fr.player.menu.settings)
    expect(await rate(), '↓ left the speed alone').toBe(1)
    await page.keyboard.press('ArrowUp')
    await expect(slider).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(opener).toBeFocused()
  })

  await test.step('a button clicked with the mouse: Space plays and pauses, it does not click again', async () => {
    await wakePlayer(page)
    await page.getByRole('button', { name: fr.player.mute, exact: true }).click()
    const state = () =>
      video.evaluate((element: HTMLVideoElement) => ({
        muted: element.muted,
        paused: element.paused,
      }))
    await expect.poll(state).toEqual({ muted: true, paused: false })
    await page.keyboard.press('Space')
    await expect.poll(state).toEqual({ muted: true, paused: true })
  })

  await test.step('play/pause clicked, the chrome fades: Enter takes it for the keyboard, Enter toggles, arrows move', async () => {
    const paused = () => video.evaluate((element: HTMLVideoElement) => element.paused)
    await wakePlayer(page)
    await page.locator('.player__control--play').click()
    await expect.poll(paused).toBe(false)
    await expect(page.locator('.player')).toHaveClass(/player--idle/, { timeout: 8_000 })
    await page.keyboard.press('Enter')
    await expect(page.getByRole('button', { name: fr.player.pause, exact: true })).toBeFocused()
    expect(await paused()).toBe(false)
    await page.keyboard.press('Enter')
    await expect.poll(paused).toBe(true)
    await page.keyboard.press('ArrowRight')
    expect((await focused(page)).label).toBe(fr.player.back10)
    // Esc lets go of the controls first; the next one leaves.
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(new RegExp(`/watch/${episode}`))
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true)
  })

  await test.step('Escape leaves the player: focus is back on the episode it was started from', async () => {
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(new RegExp(`/items/${series.id}`))
    await expect.poll(async () => isStill(await focused(page))).toBe(true)
  })
})

// A remote or a gamepad's d-pad (§19): ↑ ↓ ← →, Enter, Escape and Backspace only.
test('arrows only: profile, home rows, series, episode, skip the intro with Enter, subtitles, back (§19)', async ({
  page,
  adminRequest,
  playbackLibrary,
}) => {
  await signInMember(page, adminRequest, 'Basile')
  const video = playerVideo(page)
  const episode = playbackLibrary.seriesEpisode1.itemId
  const detail = (await (
    await page.request.get(`/api/v1/items/${episode}`)
  ).json()) as ItemDetailDto
  const series = detail.series
  if (series === undefined) throw new Error('an episode belongs to a series')
  const isStill = (element: Focused) => element.still && element.href === `/watch/${episode}`
  const isSeriesCard = (element: Focused) =>
    element.card && (element.href ?? '').startsWith(`/items/${series.id}`)

  // A second row on the home: the series in My list.
  const me = (await (await page.request.get('/api/v1/auth/me')).json()) as MeResponse
  const profileId = me.profiles[0]?.id
  if (profileId === undefined) throw new Error('the member has a profile')
  const listed = await page.request.post(`/api/v1/watchlist/${series.id}`, {
    headers: { 'X-Profile-Id': profileId },
  })
  expect(listed.ok(), `watchlist: ${listed.status()}`).toBe(true)

  await test.step('the profile picker: the first arrow focuses the profile, Enter picks it', async () => {
    await page.goto('/profiles')
    await expect(page.getByRole('button', { name: 'Basile' })).toBeVisible()
    await page.keyboard.press('ArrowRight')
    expect(await focused(page)).toMatchObject({ label: 'Basile', primary: true, keyboard: true })
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/$/)
    await expect(page.locator('#main')).toBeFocused()
  })

  await test.step('home: the hero, ↓ row 1, ↓ row 2, ↑ back on the same card of row 1', async () => {
    await page.keyboard.press('ArrowDown')
    expect(await focused(page)).toMatchObject({ primary: true, row: undefined })
    await page.keyboard.press('ArrowDown')
    const first = await focused(page)
    expect(first.card, 'row 1 has focus').toBe(true)
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    const left = await focused(page)
    expect(left).toMatchObject({ card: true, row: first.row })
    expect(left.href).not.toBe(first.href)
    // One Tab stop per row: the card last focused.
    const stops = await page.evaluate(
      (row) =>
        [...document.querySelectorAll(`section[aria-labelledby="${row}"] a.card`)].filter(
          (card) => (card as HTMLElement).tabIndex === 0,
        ).length,
      left.row,
    )
    expect(stops).toBe(1)
    await page.keyboard.press('ArrowDown')
    const below = await focused(page)
    expect(below.card, 'row 2 has focus').toBe(true)
    expect(below.row).not.toBe(left.row)
    await page.keyboard.press('ArrowUp')
    expect(await focused(page)).toMatchObject({ card: true, row: left.row, href: left.href })
  })

  await test.step('the context-menu key opens the card’s actions; Esc gives focus back to the card', async () => {
    const left = await focused(page)
    const menu = page.locator('dialog.card-menu')
    await page.keyboard.press('ContextMenu')
    await expect(menu).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    expect(await focused(page)).toMatchObject({ card: true, href: left.href })
  })

  await test.step('the series in My list opens with Enter', async () => {
    await pressUntil(
      page,
      'ArrowDown',
      (element) => element.row === 'row-watchlist',
      'the My list row',
      6,
    )
    await pressUntil(page, 'ArrowRight', isSeriesCard, 'the card of the series', 20)
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(new RegExp(`/items/${series.id}`))
    await expect(page.locator('.episode__still').first()).toBeVisible()
    await expect(page.locator('#main')).toBeFocused()
  })

  await test.step('series page: the main action first, ↓ to episode 1, Enter plays it', async () => {
    await page.keyboard.press('ArrowDown')
    expect((await focused(page)).primary).toBe(true)
    await pressUntil(page, 'ArrowDown', isStill, 'the still of episode 1', 15)
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(new RegExp(`/watch/${episode}`))
  })

  await test.step('player: Enter takes "Skip intro"', async () => {
    const skip = page.getByRole('button', { name: fr.player.skip.intro })
    await expect(skip).toBeVisible({ timeout: 20_000 })
    await page.keyboard.press('Enter')
    await expectPlayingPast(video, intro.endS - 0.1, 10_000)
    await expect(skip).toBeHidden()
    expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false)
  })

  await test.step('Enter wakes the controls on play/pause; → reaches subtitles and audio', async () => {
    const pause = page.getByRole('button', { name: fr.player.pause, exact: true })
    await page.keyboard.press('Enter')
    await expect(pause).toBeFocused()
    expect(await video.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false)
    const opener = page.getByRole('button', { name: fr.player.menu.title, exact: true })
    await pressUntil(
      page,
      'ArrowRight',
      (element) => element.label === fr.player.menu.title,
      'the menu',
      15,
    )
    const at = await currentTime(video)
    expect(at, '→ moved focus, it did not seek').toBeLessThan(intro.endS + 8)
    await page.keyboard.press('Enter')
    const menu = page.getByRole('dialog', { name: fr.player.menu.title })
    await expect(menu).toBeVisible()
    await pressUntil(
      page,
      'ArrowDown',
      (element) => element.role === 'radio' && /^anglais/i.test(element.label),
      'English subtitles',
      5,
    )
    await page.keyboard.press('Enter')
    await expect(
      menu
        .getByRole('radiogroup', { name: fr.player.menu.subtitles, exact: true })
        .getByRole('radio', { name: /^anglais/i }),
    ).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(opener).toBeFocused()
  })

  await test.step('Escape lets go of the controls, Backspace leaves: focus is back on the episode', async () => {
    await page.keyboard.press('Escape')
    await expect(page.locator('.player')).toHaveClass(/player--idle/)
    await expect(page).toHaveURL(new RegExp(`/watch/${episode}`))
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true)
    await page.keyboard.press('Backspace')
    await expect(page).toHaveURL(new RegExp(`/items/${series.id}`))
    await expect.poll(async () => isStill(await focused(page))).toBe(true)
  })

  await test.step('Backspace on the series page goes back to the home, focus on the card', async () => {
    await page.keyboard.press('Backspace')
    await expect(page).toHaveURL(/\/$/)
    await expect.poll(async () => isSeriesCard(await focused(page))).toBe(true)
  })

  await test.step('in a form, Backspace on a control (a colour) does not leave the page', async () => {
    await page.goto('/settings/profile')
    // The page renders first (a lazy route): arrows before that land nowhere.
    await expect(page.locator('input[type="radio"]').first()).toBeAttached()
    const onRadio = () =>
      page.evaluate(() => document.activeElement?.matches('input[type="radio"]') === true)
    for (let press = 0; press < 5 && !(await onRadio()); press += 1)
      await page.keyboard.press('ArrowDown')
    expect(await onRadio(), '↓ reaches the colours').toBe(true)
    await page.keyboard.press('Backspace')
    await page.waitForTimeout(300)
    await expect(page).toHaveURL(/\/settings\/profile$/)
    expect(await onRadio()).toBe(true)
  })
})

// A pad with the standard mapping (an Xbox pad), driven from the test: Chromium
// reports it once connected; buttons and the left stick are held between two
// reads of the page.
type FakePad = {
  connect: () => void
  hold: (button: number, pressed: boolean) => void
  tilt: (x: number, y: number) => void
}

const installFakePad = () => {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }))
  const pad = {
    id: 'Fake pad (STANDARD GAMEPAD)',
    index: 0,
    connected: false,
    mapping: 'standard',
    timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons,
  }
  Object.defineProperty(navigator, 'getGamepads', {
    configurable: true,
    value: () => [pad.connected ? pad : undefined, undefined, undefined, undefined],
  })
  const fake: FakePad = {
    connect: () => {
      pad.connected = true
      window.dispatchEvent(new Event('gamepadconnected'))
    },
    hold: (button, pressed) => {
      buttons[button] = { pressed, touched: pressed, value: pressed ? 1 : 0 }
      pad.timestamp = performance.now()
    },
    tilt: (x, y) => {
      pad.axes = [x, y, 0, 0]
      pad.timestamp = performance.now()
    },
  }
  Object.assign(window, { fakePad: fake })
}

type PadAction = { button: number; down: boolean } | { x: number; y: number }

const padOf = (page: Page) => {
  // Applies `action`, then waits two frames: the page has read it.
  const apply = (action: PadAction) =>
    page.evaluate(
      (what) =>
        new Promise<void>((done) => {
          const fake = (window as unknown as { fakePad: FakePad }).fakePad
          if ('button' in what) fake.hold(what.button, what.down)
          else fake.tilt(what.x, what.y)
          requestAnimationFrame(() => requestAnimationFrame(() => done()))
        }),
      action,
    )
  return {
    connect: () =>
      page.evaluate(() => (window as unknown as { fakePad: FakePad }).fakePad.connect()),
    // Pressed for a few frames, well under the repeat delay, then released.
    press: async (button: number) => {
      await apply({ button, down: true })
      await apply({ button, down: false })
    },
    hold: async (button: number, ms: number) => {
      await apply({ button, down: true })
      await page.waitForTimeout(ms)
      await apply({ button, down: false })
    },
    tilt: async (x: number, y: number) => {
      await apply({ x, y })
      await apply({ x: 0, y: 0 })
    },
  }
}

// How many times focus moves while `act` runs.
const countFocusMoves = async (page: Page, act: () => Promise<void>) => {
  await page.evaluate(() => {
    const counter = { moves: 0 }
    document.addEventListener('focusin', () => {
      counter.moves += 1
    })
    Object.assign(window, { focusCounter: counter })
  })
  await act()
  return page.evaluate(
    () => (window as unknown as { focusCounter: { moves: number } }).focusCounter.moves,
  )
}

const pad = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, up: 12, down: 13, left: 14, right: 15 }

test('gamepad: d-pad and stick, A and B on the home, Y for a card’s menu, X, LB/RB, menus and B in the player (§19)', async ({
  page,
  adminRequest,
  playbackLibrary,
}) => {
  await page.addInitScript(installFakePad)
  await signInMember(page, adminRequest, 'Gaspard')
  const video = playerVideo(page)
  const fake = padOf(page)

  await test.step('the profile picker: → focuses the profile, A picks it', async () => {
    await page.goto('/profiles')
    await expect(page.getByRole('button', { name: 'Gaspard' })).toBeVisible()
    await fake.connect()
    await fake.press(pad.right)
    expect(await focused(page)).toMatchObject({ label: 'Gaspard', keyboard: true })
    await fake.press(pad.a)
    await expect(page).toHaveURL(/\/$/)
    await expect(page.locator('#main')).toBeFocused()
  })

  let card: Focused | undefined
  await test.step('home: ↓ to the hero, ↓ to a row, → along it, A opens the title, B comes back on the card', async () => {
    await fake.press(pad.down)
    expect(await focused(page)).toMatchObject({ primary: true, row: undefined })
    await fake.press(pad.down)
    const first = await focused(page)
    expect(first.card, 'a row has focus').toBe(true)
    await fake.press(pad.right)
    card = await focused(page)
    expect(card).toMatchObject({ card: true, row: first.row, keyboard: true })
    expect(card.href).not.toBe(first.href)
    await fake.press(pad.a)
    await expect(page).toHaveURL(/\/items\//)
    await fake.press(pad.b)
    await expect(page).toHaveURL(/\/$/)
    const left = card
    await expect.poll(async () => (await focused(page)).href).toBe(left.href)
  })

  await test.step('Y opens the card’s menu, B closes it, focus back on the card', async () => {
    const menu = page.locator('dialog.card-menu')
    await fake.press(pad.y)
    await expect(menu).toBeVisible()
    await fake.press(pad.b)
    await expect(menu).toBeHidden()
    await expect(page).toHaveURL(/\/$/)
    expect(await focused(page)).toMatchObject({ card: true, href: card?.href })
  })

  await test.step('→ held repeats along the row; the left stick moves back one card', async () => {
    const moves = await countFocusMoves(page, () => fake.hold(pad.right, 700))
    expect(moves, 'one move, then repeats after the delay').toBeGreaterThanOrEqual(3)
    const reached = await focused(page)
    expect(reached).toMatchObject({ card: true, row: card?.row })
    await fake.tilt(-0.9, 0.1)
    const back = await focused(page)
    expect(back).toMatchObject({ card: true, row: card?.row })
    expect(back.href).not.toBe(reached.href)
  })

  await test.step('player: X pauses, RB seeks +10 s, LB −10 s', async () => {
    await page.goto(`/watch/${playbackLibrary.quality.itemId}`)
    await expectPlayingPast(video, 1, 20_000)
    // A new document: the pad is reported again.
    await fake.connect()
    await fake.press(pad.x)
    const paused = () => video.evaluate((element: HTMLVideoElement) => element.paused)
    await expect.poll(paused).toBe(true)
    const at = await currentTime(video)
    await fake.press(pad.rb)
    await expect.poll(() => currentTime(video)).toBeGreaterThan(at + 9)
    const ahead = await currentTime(video)
    expect(ahead).toBeLessThan(at + 11)
    await fake.press(pad.lb)
    await expect.poll(() => currentTime(video)).toBeLessThan(ahead - 9)
    expect(await paused()).toBe(true)
  })

  await test.step('player: A on the controls, → to Settings, A opens it on the speed, → steps it, ↓ steps through the quality options, B closes it', async () => {
    await fake.press(pad.a)
    await expect(page.locator('.player__control--play')).toBeFocused()
    for (let press = 0; press < 12; press += 1) {
      if ((await focused(page)).label === fr.player.menu.settings) break
      await fake.press(pad.right)
    }
    expect((await focused(page)).label).toBe(fr.player.menu.settings)
    await fake.press(pad.a)
    const menu = page.getByRole('dialog', { name: fr.player.menu.settings })
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('slider')).toBeFocused()
    const rate = () => video.evaluate((element: HTMLVideoElement) => element.playbackRate)
    expect(await rate()).toBe(1)
    await fake.press(pad.right)
    await expect.poll(rate).toBe(1.5)

    await fake.press(pad.down)
    const first = await focused(page)
    expect(first.role, '↓ leaves the slider for an option').toBe('radio')
    expect(first.dialog).toBe(fr.player.menu.settings)
    const checkedOf = (label: string) =>
      menu.getByRole('radio', { name: label, exact: true }).getAttribute('aria-checked')
    const before = await checkedOf(first.label)
    await fake.press(pad.down)
    const next = await focused(page)
    expect(next.role).toBe('radio')
    expect(next.label).not.toBe(first.label)
    expect(await checkedOf(first.label), '↓ moves focus, it picks nothing').toBe(before)
    // From an option out of the Tab order, ↑ steps back (focus is not lost).
    await fake.press(pad.up)
    expect((await focused(page)).label).toBe(first.label)
    await fake.press(pad.b)
    await expect(menu).toBeHidden()
    await expect(
      page.getByRole('button', { name: fr.player.menu.settings, exact: true }),
    ).toBeFocused()
  })

  await test.step('player: B lets go of the controls, B again leaves', async () => {
    await fake.press(pad.b)
    await expect(page).toHaveURL(/\/watch\//)
    await fake.press(pad.b)
    await expect(page).not.toHaveURL(/\/watch\//)
  })
})
