import { TEST_TMDB_KEY } from '../../apps/server/test/support/tmdb-server.ts'
import { admin } from '../support/accounts.ts'
import { expect, test } from '../support/fixtures.ts'
import { fr, startsWith, tr } from '../support/i18n.ts'
import {
  expectedMovies,
  expectedSeries,
  fixtureFiles,
  identifiedTitles,
} from '../support/library.ts'
import { currentTime, expectPoster, playbackStart, wakePlayer } from '../support/media.ts'

/**
 * §4 parcours 1: first launch, library added through the folder explorer, TMDB key set from the
 * administration, films and series with clean titles and their posters, playback and resume.
 * Then login / logout and parcours 2 (invitation). The UI runs in French (`locale`).
 */
test.describe.configure({ mode: 'serial' })

test('first launch: wizard, library from the folder explorer, TMDB key, titles with posters, play and resume', async ({
  page,
  libraryDir,
}) => {
  await test.step('setup wizard: welcome, then the admin account', async () => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/setup$/)
    await page.getByRole('button', { name: fr.setup.welcome.start }).click()
    await expect(page.getByRole('heading', { name: fr.setup.account.title })).toBeVisible()
    const next = page.getByRole('button', { name: fr.common.continue })
    await expect(next).toBeDisabled()
    await page.getByLabel(fr.setup.account.username).fill(admin.username)
    await page.getByLabel(fr.setup.account.password, { exact: true }).fill(admin.password)
    await page.getByLabel(fr.setup.account.confirmation).fill(admin.password)
    await next.click()
    await expect(page.getByRole('heading', { name: fr.setup.library.title })).toBeVisible()
  })

  await test.step('library: walk the folder explorer down to the fixtures', async () => {
    // First launch shows folders and name only: content type and options keep their defaults.
    await expect(page.getByRole('radiogroup', { name: fr.admin.form.contentType })).toHaveCount(0)
    await expect(page.getByLabel(fr.admin.form.quietPeriod)).toHaveCount(0)
    await page.getByRole('button', { name: fr.setup.library.browse }).click()
    const dialog = page.getByRole('dialog', { name: fr.admin.browser.title })
    await expect(dialog).toBeVisible()
    const location = dialog
      .getByRole('navigation', { name: fr.admin.browser.breadcrumb })
      .locator('[aria-current="location"]')
    await expect(location).toHaveText('/')
    for (const segment of libraryDir.split('/').filter((part) => part !== '')) {
      await dialog.getByRole('listitem').getByRole('button', { name: segment, exact: true }).click()
      await expect(location).toHaveText(segment)
    }
    await dialog.getByRole('button', { name: fr.admin.browser.pick }).click()
    await expect(dialog).toBeHidden()
    const folders = page.getByRole('list', { name: fr.admin.form.folders })
    await expect(folders.getByRole('listitem')).toHaveText([libraryDir])
    await expect(folders.getByRole('checkbox', { name: libraryDir })).toBeChecked()
    // The name is suggested by the folder.
    const folderName =
      libraryDir
        .split('/')
        .filter((part) => part !== '')
        .at(-1) ?? ''
    await expect(page.getByLabel(fr.admin.form.name, { exact: true })).toHaveValue(
      folderName.charAt(0).toLocaleUpperCase('fr') + folderName.slice(1),
    )
    await page.getByRole('button', { name: fr.setup.library.submit, exact: true }).click()
  })

  await test.step('ready: the first scan runs, on to the administration', async () => {
    await expect(
      page.getByRole('heading', { name: tr(fr.setup.ready.title, { name: admin.username }) }),
    ).toBeVisible()
    await expect(page.getByRole('region', { name: fr.setup.ready.scan })).toBeVisible()
    await page.getByRole('link', { name: fr.setup.ready.admin }).click()
  })

  await test.step('settings: no quiet period, the fixtures are complete files', async () => {
    await expect(page).toHaveURL(/\/admin\/libraries$/)
    const row = page.getByRole('row').filter({ hasText: libraryDir })
    await row.getByRole('button', { name: startsWith(fr.admin.libraries.more) }).click()
    await row.getByRole('link', { name: fr.admin.libraries.edit }).click()
    await expect(page.getByLabel(fr.admin.form.quietPeriod)).toHaveValue('120')
    await page.getByLabel(fr.admin.form.quietPeriod).fill('0')
    await page.getByRole('button', { name: fr.common.save }).click()
  })

  await test.step('scan: every source becomes ready', async () => {
    await expect(page).toHaveURL(/\/admin\/libraries$/)
    const row = page.getByRole('row').filter({ hasText: libraryDir })
    await expect(row).toContainText(
      tr(fr.admin.counts.ready_other, { formatted: fixtureFiles.length }),
      { timeout: 90_000 },
    )
    // "À jour" only once the quiet period, the probes and the sample decodes are all done.
    await expect(row.getByRole('status')).toContainText(fr.admin.status.ok)
  })

  await test.step('TMDB key: the banner leads to the settings, the key is checked', async () => {
    const banner = page.getByRole('status').filter({ hasText: fr.admin.banner.tmdbKeyMissing })
    await banner.getByRole('link', { name: fr.admin.banner.configure }).click()
    await expect(page).toHaveURL(/\/admin\/settings\/metadata$/)
    await expect(
      page.getByRole('heading', { name: fr.admin.settings.metadata, level: 1 }),
    ).toBeVisible()
    // "Intros and credits" has its own page and key form (TheIntroDB, §15): the TMDB one is here.
    const metadata = page.getByRole('region', { name: fr.admin.settings.metadata })
    await metadata.getByLabel(fr.admin.settings.tmdbKey).fill(TEST_TMDB_KEY)
    await metadata.getByRole('button', { name: fr.admin.settings.validateKey }).click()
    await expect(
      metadata.getByText(tr(fr.admin.settings.configuredWith, { last4: TEST_TMDB_KEY.slice(-4) })),
    ).toBeVisible()
  })

  await test.step('identification: what TMDB does not know waits in "À vérifier"', async () => {
    await page
      .getByRole('navigation', { name: fr.admin.title })
      .getByRole('link', { name: startsWith(fr.admin.review.title) })
      .click()
    await expect(page.getByRole('heading', { name: fr.admin.review.title, level: 1 })).toBeVisible()
    // Every other file is identified: only the made-up series is left to the admin.
    const queue = page.getByRole('list', { name: fr.admin.review.title }).getByRole('listitem')
    await expect(queue).toHaveCount(1, { timeout: 30_000 })
    await expect(queue).toContainText('Show.Name.S01E02.1080p.WEB.x264.mkv')
    await expect(queue).toContainText(fr.admin.review.reason.no_match)
  })

  await test.step('catalog: Films and Séries show clean titles and their posters', async () => {
    await page.getByRole('link', { name: fr.admin.backToCatalog }).click()
    const nav = page.getByRole('navigation', { name: fr.shell.mainNavigation })
    await nav.getByRole('link', { name: fr.nav.movies }).click()
    await expect(page.getByRole('heading', { name: fr.nav.movies, level: 1 })).toBeVisible()
    const movieTiles = page.getByRole('main').getByRole('list').getByRole('link')
    await expect(movieTiles).toHaveText(
      expectedMovies.map(({ title, year }) => new RegExp(`^${title}\\s*${year}$`)),
    )
    for (const { title } of expectedMovies) {
      await expectPoster(movieTiles.filter({ hasText: title }))
    }

    await nav.getByRole('link', { name: fr.nav.series }).click()
    await expect(page.getByRole('heading', { name: fr.nav.series, level: 1 })).toBeVisible()
    const seriesTiles = page.getByRole('main').getByRole('list').getByRole('link')
    await expect(seriesTiles).toHaveText(expectedSeries.map((title) => new RegExp(`^${title}`)))
    for (const title of expectedSeries) {
      const tile = seriesTiles.filter({ hasText: title })
      if (identifiedTitles.some((identified) => identified === title)) await expectPoster(tile)
      // Unidentified: the title on its tone, never a broken image.
      else await expect(tile.locator('img')).toHaveCount(0)
    }

    await nav.getByRole('link', { name: fr.nav.movies }).click()
    await movieTiles.filter({ hasText: 'Inception' }).click()
    await expect(page.getByRole('heading', { name: 'Inception', level: 1 })).toBeVisible()
  })

  const video = page.locator('video')
  let pausedAt = 0

  await test.step('playback: the MKV really plays', async () => {
    await page.getByRole('link', { name: fr.item.play, exact: true }).click()
    await expect(page).toHaveURL(/\/watch\//)
    await expect
      .poll(() => currentTime(video), { intervals: [50], timeout: 30_000 })
      .toBeGreaterThan(0.3)

    await wakePlayer(page)
    await page.getByRole('button', { name: fr.player.pause }).click()
    await expect(page.getByRole('button', { name: fr.player.play }).first()).toBeVisible()
    pausedAt = await currentTime(video)
    expect(pausedAt).toBeGreaterThan(0.3)

    await page.getByRole('button', { name: fr.player.quit }).click()
  })

  await test.step('resume: the page offers "Reprendre", playback restarts near the position', async () => {
    await expect(page.getByRole('heading', { name: 'Inception', level: 1 })).toBeVisible()
    const resume = page.getByRole('link', { name: startsWith(fr.item.resumeAt) })
    await expect(resume).toBeVisible()
    await resume.click()
    await expect
      .poll(() => playbackStart(video), { intervals: [50], timeout: 30_000 })
      .toBeGreaterThan(0)
    const resumedAt = await playbackStart(video)
    expect(resumedAt).toBeGreaterThanOrEqual(pausedAt - 0.5)
    expect(resumedAt).toBeLessThan(pausedAt + 1.5)
  })
})

test('login and logout, wrong password shows a translated message', async ({ page }) => {
  await page.goto('/movies')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('heading', { name: fr.login.title })).toBeVisible()

  await page.getByLabel(fr.login.username).fill(admin.username)
  await page.getByLabel(fr.login.password, { exact: true }).fill('not-the-password')
  await page.getByRole('button', { name: fr.login.submit }).click()
  await expect(page.getByRole('alert')).toHaveText(fr.errors['auth/invalid_credentials'])

  await page.getByLabel(fr.login.password, { exact: true }).fill(admin.password)
  await page.getByRole('button', { name: fr.login.submit }).click()
  await expect(page).toHaveURL(/\/movies$/)
  await expect(page.getByRole('heading', { name: fr.nav.movies, level: 1 })).toBeVisible()

  await page.getByRole('button', { name: startsWith(fr.shell.accountMenu) }).click()
  await page.getByRole('button', { name: fr.shell.logout }).click()
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('heading', { name: fr.login.title })).toBeVisible()

  // The session is really gone: the catalog sends back to the login.
  await page.goto('/movies')
  await expect(page).toHaveURL(/\/login/)
})

test('invitation: a new member chooses a password and lands on the home (§4 parcours 2)', async ({
  page,
  browser,
}) => {
  const login = await page.request.post('/api/v1/auth/login', { data: admin })
  expect(login.ok()).toBe(true)
  const created = await page.request.post('/api/v1/admin/invitations')
  expect(created.status()).toBe(201)
  const { token } = (await created.json()) as { token: string }

  const guest = await browser.newContext()
  const invited = await guest.newPage()
  await invited.goto(`/invite/${token}`)
  await expect(invited.getByRole('heading', { name: fr.invite.title })).toBeVisible()
  const submit = invited.getByRole('button', { name: fr.invite.submit })
  await expect(submit).toBeDisabled()
  await invited.getByLabel(fr.invite.name).fill('Camille')
  await invited.getByLabel(fr.setup.account.username).fill('camille')
  await invited.getByLabel(fr.setup.account.password, { exact: true }).fill('camille-e2e-password')
  await invited.getByLabel(fr.setup.account.confirmation).fill('camille-e2e-password')
  await submit.click()

  await expect(invited).toHaveURL(/\/$/)
  await expect(
    invited.getByRole('navigation', { name: fr.shell.mainNavigation }).getByRole('link', {
      name: fr.nav.home,
    }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(
    invited.getByRole('button', { name: tr(fr.shell.accountMenu, { name: 'Camille' }) }),
  ).toBeVisible()

  // The link was single use.
  await invited.goto(`/invite/${token}`)
  await expect(invited.getByRole('heading', { name: fr.invite.used })).toBeVisible()
  await guest.close()
})
