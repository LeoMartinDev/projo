import { expect, type Locator, type Page } from '@playwright/test'

export const currentTime = (video: Locator) =>
  video.evaluate((element: HTMLVideoElement) => element.currentTime)

export const playbackStart = (video: Locator) =>
  video.evaluate(({ played }: HTMLVideoElement) =>
    played.length === 0 ? 0 : played.start(played.length - 1),
  )

export const wakePlayer = async (page: Page) => {
  const size = page.viewportSize() ?? { width: 800, height: 600 }
  await page.mouse.move(size.width / 2, size.height / 2)
  await page.mouse.move(size.width / 2 + 10, size.height / 2 + 10)
}

export const expectPoster = async (tile: Locator, timeout = 10_000) => {
  const image = tile.locator('img')
  await expect(image).toHaveAttribute('src', /^\/api\/v1\/images\/[^/]+$/, { timeout })
  await image.scrollIntoViewIfNeeded()
  const decodedWidth = () =>
    image.evaluate((element: HTMLImageElement) => (element.complete ? element.naturalWidth : 0))
  await expect.poll(decodedWidth, { timeout }).toBeGreaterThan(0)
}
