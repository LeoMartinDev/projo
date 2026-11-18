import type {
  AdminTvSessionsResponse,
  AdminTvSourceDto,
  TvSessionDto,
} from '../../packages/shared/api/tv.ts'
import { admin, signIn } from '../support/accounts.ts'
import { expect, test } from '../support/fixtures.ts'
import { fr } from '../support/i18n.ts'
import { currentTime } from '../support/media.ts'
import { iptvBaseUrl } from '../support/paths.ts'
import { playerVideo, signInMember } from '../support/playback.ts'

const sourceName = 'Fournisseur e2e'

const isLiveSessionCreation = (url: string, method: string) =>
  method === 'POST' && /\/api\/v1\/tv\/channels\/[^/]+\/sessions$/.test(new URL(url).pathname)

const isLiveSessionEnd = (url: string, method: string, sessionId: string) =>
  method === 'DELETE' && new URL(url).pathname === `/api/v1/tv/sessions/${sessionId}`

test('live TV: the admin adds an M3U source and enables a group, a profile plays a channel, zaps and leaves (§29.8 journey 6)', async ({
  page,
  adminRequest,
}) => {
  test.setTimeout(150_000)
  const video = playerVideo(page)
  try {
    await test.step('Admin → TV: add the M3U source, then enable its "Live" group', async () => {
      await signIn(page, admin)
      await page.goto('/admin/tv')
      await page.getByRole('button', { name: fr.admin.tv.add }).click()
      const adding = page.getByRole('dialog', { name: fr.admin.tv.addTitle })
      await adding.getByLabel(fr.admin.tv.form.name).fill(sourceName)
      await adding.getByLabel(fr.admin.tv.form.playlistUrl).fill(`${iptvBaseUrl}/m3u/live.m3u`)
      await adding.getByRole('button', { name: fr.admin.tv.form.create }).click()
      await expect(adding).toBeHidden()
      await page.getByRole('button', { name: sourceName }).click()
      const dialog = page.getByRole('dialog', { name: sourceName })
      // Its groups once the first refresh has read the playlist.
      const live = dialog.getByRole('switch', { name: 'Live', exact: true })
      await expect(live).toBeVisible({ timeout: 30_000 })
      await expect(live).not.toBeChecked()
      await live.click()
      await expect(live).toBeChecked()
      await expect(dialog.getByText('4 / 4')).toBeVisible()
    })

    await test.step('a profile finds "TV" in the navigation, its channels by group', async () => {
      await signInMember(page, adminRequest, 'Zoé')
      await page.goto('/')
      await page.getByRole('link', { name: fr.nav.tv, exact: true }).click()
      await expect(page).toHaveURL(/\/tv$/)
      await expect(page.getByRole('heading', { name: 'Live', level: 2 })).toBeVisible()
      await expect(page.getByRole('link', { name: /^\d+ Live / })).toHaveCount(4)
    })

    // The live session requests, in the order the page sends them.
    const sent: string[] = []
    page.on('request', (request) => {
      const { pathname } = new URL(request.url())
      if (pathname.startsWith('/api/v1/tv/') && pathname.includes('/sessions'))
        sent.push(`${request.method()} ${pathname}`)
    })
    let session: TvSessionDto | undefined

    await test.step('a channel plays live', async () => {
      const created = page.waitForResponse(
        (response) => isLiveSessionCreation(response.url(), response.request().method()),
        { timeout: 45_000 },
      )
      await page.getByRole('link', { name: '1 Live One' }).click()
      await expect(page).toHaveURL(/\/watch\/tv\//)
      const answer = await created
      expect(answer.status()).toBe(201)
      session = (await answer.json()) as TvSessionDto
      await expect.poll(() => currentTime(video), { timeout: 30_000 }).toBeGreaterThan(0)
      const start = await currentTime(video)
      await expect
        .poll(() => currentTime(video), { intervals: [200], timeout: 20_000 })
        .toBeGreaterThan(start + 1)
    })

    await test.step('PageDown zaps to the next channel, the old session ends first', async () => {
      const previous = session?.sessionId ?? ''
      const ended = page.waitForResponse((response) =>
        isLiveSessionEnd(response.url(), response.request().method(), previous),
      )
      const created = page.waitForResponse(
        (response) => isLiveSessionCreation(response.url(), response.request().method()),
        { timeout: 45_000 },
      )
      sent.splice(0)
      await page.keyboard.press('PageDown')
      expect((await ended).status()).toBe(204)
      const answer = await created
      expect(answer.status()).toBe(201)
      session = (await answer.json()) as TvSessionDto
      const ending = sent.indexOf(`DELETE /api/v1/tv/sessions/${previous}`)
      const creating = sent.findIndex((line) => line.startsWith('POST '))
      expect(ending).toBeGreaterThanOrEqual(0)
      expect(ending).toBeLessThan(creating)
      await expect(page.getByText('Live MP2', { exact: true })).toBeVisible()
      await expect.poll(() => currentTime(video), { timeout: 30_000 }).toBeGreaterThan(0)
      const start = await currentTime(video)
      await expect
        .poll(() => currentTime(video), { intervals: [200], timeout: 20_000 })
        .toBeGreaterThan(start + 1)
    })

    await test.step('leaving the player ends its session', async () => {
      const current = session?.sessionId ?? ''
      const ended = page.waitForResponse((response) =>
        isLiveSessionEnd(response.url(), response.request().method(), current),
      )
      await page.mouse.move(200, 200)
      await page.getByRole('button', { name: fr.player.quit }).click()
      await expect(page).not.toHaveURL(/\/watch\/tv\//)
      expect((await ended).status()).toBe(204)
      const live = await adminRequest.get('/api/v1/admin/tv/sessions')
      expect(((await live.json()) as AdminTvSessionsResponse).items).toEqual([])
    })
  } finally {
    const sources = await adminRequest.get('/api/v1/admin/tv/sources')
    const { items } = (await sources.json()) as { items: AdminTvSourceDto[] }
    for (const source of items.filter(({ name }) => name === sourceName))
      await adminRequest.delete(`/api/v1/admin/tv/sources/${source.id}`)
  }
})
