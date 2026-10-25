import { renameSync } from 'node:fs'
import { join } from 'node:path'

import type { APIRequestContext } from '@playwright/test'

import type { SourcesPage } from '../../packages/shared/api/libraries.ts'
import { admin, apiSignIn, createMember, signIn } from '../support/accounts.ts'
import { expect, test } from '../support/fixtures.ts'
import { fr, matching, startsWith } from '../support/i18n.ts'
import { unidentifiedFile } from '../support/library.ts'
import { expectPoster } from '../support/media.ts'

/**
 * §4 journey 5: a file TMDB cannot identify shows up in "To review", the admin searches the
 * right TMDB title and assigns it, the movie shows up for the household, and a full scan does
 * not undo the correction (§7.8: `item_manual_matches` wins over the automatic matching).
 */
const sam = { username: 'sam', password: 'sam-e2e-password', profileName: 'Sam' }
const rightTitle = "Le Fabuleux Destin d'Amélie Poulain"
/** What the parser makes of the file name (title case): what TMDB is first asked for. */
const parsedTitle = 'Lfddap'

/** Relative paths of the "To review" queue (`match_state = needs_review`), every library. */
const reviewQueuePaths = async (api: APIRequestContext): Promise<string[]> => {
  const response = await api.get('/api/v1/admin/sources', {
    params: { matchState: 'needs_review', limit: 200 },
  })
  expect(response.ok(), `review queue: ${response.status()}`).toBe(true)
  return ((await response.json()) as SourcesPage).items.map((source) => source.relativePath)
}

test('correction: unidentified file, TMDB search and assignment, survives a full scan', async ({
  page,
  browser,
  request,
  libraryDir,
  incomingDir,
}) => {
  await apiSignIn(request, admin)
  await createMember(request, sam)
  const household = await browser.newContext()
  await apiSignIn(household.request, sam)
  const member = await household.newPage()
  const memberMovies = member.getByRole('main').getByRole('list').getByRole('link')

  await test.step('a file the scene named "LFDDAP" lands in the library', async () => {
    renameSync(join(incomingDir, unidentifiedFile.path), join(libraryDir, unidentifiedFile.path))
  })

  const queue = page.getByRole('list', { name: fr.admin.review.title }).getByRole('listitem')
  const entry = queue.filter({ hasText: unidentifiedFile.path })

  await test.step('the admin finds it in "To review": TMDB has no such title', async () => {
    await signIn(page, admin)
    await page.getByRole('button', { name: startsWith(fr.shell.accountMenu) }).click()
    await page.getByRole('link', { name: fr.shell.admin }).click()
    await page
      .getByRole('navigation', { name: fr.admin.title })
      .getByRole('link', { name: startsWith(fr.admin.review.title) })
      .click()
    await expect(page.getByRole('heading', { name: fr.admin.review.title, level: 1 })).toBeVisible()
    // Watcher, probe, then TMDB: it arrives live.
    await expect(entry).toBeVisible({ timeout: 60_000 })
    await expect(entry).toContainText(fr.admin.review.reason.no_match)
    await expect(entry).toContainText(fr.admin.review.classification.movie)
  })

  await test.step('the admin searches TMDB for the right title and assigns it', async () => {
    await entry.getByRole('button', { name: fr.admin.review.identify }).click()
    const dialog = page.getByRole('dialog', { name: fr.admin.review.identifyTitle })
    await expect(dialog).toBeVisible()
    await expect(
      dialog.getByRole('radio', { name: fr.admin.identify.mode.movie, exact: true }),
    ).toHaveAttribute('aria-checked', 'true')
    // Prefilled from the file name.
    const query = dialog.getByLabel(fr.admin.identify.movieTitle)
    await expect(query).toHaveValue(parsedTitle)
    await expect(dialog.getByLabel(fr.admin.identify.year)).toHaveValue('2001')
    await expect(dialog.getByText(fr.admin.identify.noResults)).toBeVisible()

    await query.fill(rightTitle)
    const results = dialog.getByRole('radiogroup', { name: fr.admin.identify.results })
    const pick = results.getByRole('radio', { name: rightTitle })
    await expect(results.getByRole('radio')).toHaveCount(1)
    await pick.click()
    await expect(pick).toHaveAttribute('aria-checked', 'true')
    await dialog.getByRole('button', { name: fr.admin.identify.assign }).click()
    await expect(dialog).toBeHidden()
    await expect(entry).toHaveCount(0)
  })

  await test.step('the household sees the movie, with its poster', async () => {
    await member.goto('/movies')
    await expect(member.getByRole('heading', { name: fr.nav.movies, level: 1 })).toBeVisible()
    const tile = memberMovies.filter({ hasText: rightTitle })
    await expect(tile).toHaveText(new RegExp(`${rightTitle}\\s*2001$`), { timeout: 15_000 })
    await expectPoster(tile, 15_000)
    await expect(memberMovies.filter({ hasText: parsedTitle })).toHaveCount(0)
  })

  await test.step('the admin runs a full scan of the library', async () => {
    await page
      .getByRole('navigation', { name: fr.admin.title })
      .getByRole('link', { name: fr.admin.libraries.title })
      .click()
    const row = page.getByRole('row').filter({ hasText: libraryDir })
    await row.getByRole('button', { name: startsWith(fr.admin.libraries.more) }).click()
    await row.getByRole('link', { name: fr.admin.libraries.edit }).click()
    const history = page.getByRole('region', { name: fr.admin.history.title }).getByRole('listitem')
    const fullScans = history.filter({ hasText: fr.admin.scanKind.manual_full })
    await expect(fullScans).toHaveCount(0)
    await page.getByRole('button', { name: fr.admin.libraries.fullScan }).click()
    // Finished: its line shows the counts instead of "Analyse en cours".
    await expect(fullScans).toHaveCount(1)
    await expect(fullScans).toContainText(matching(fr.admin.history.stats), { timeout: 60_000 })
  })

  await test.step('the correction holds: still identified, not back in "To review"', async () => {
    await member.reload()
    const tile = memberMovies.filter({ hasText: rightTitle })
    await expect(tile).toHaveText(new RegExp(`${rightTitle}\\s*2001$`))
    await expectPoster(tile)
    await expect(memberMovies.filter({ hasText: parsedTitle })).toHaveCount(0)
    // A manual match is never offered to TMDB again: once the scan is over, its state is final.
    expect(await reviewQueuePaths(request)).not.toContain(unidentifiedFile.path)
  })

  await household.close()
})
