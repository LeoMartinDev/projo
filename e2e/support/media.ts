import { expect, type Locator, type Page } from '@playwright/test'

export const currentTime = (video: Locator) =>
  video.evaluate((element: HTMLVideoElement) => element.currentTime)

/**
 * Where playback really started: the start of the last range of `video.played`, `0` before a
 * frame has played. Unlike `currentTime`, it stays put while the video plays: on a loaded CI
 * runner, two reads of a WebKit page can be seconds apart.
 */
export const playbackStart = (video: Locator) =>
  video.evaluate(({ played }: HTMLVideoElement) =>
    played.length === 0 ? 0 : played.start(played.length - 1),
  )

/** Player chrome hides after 3 s of inactivity: a pointer move brings it back. */
export const wakePlayer = async (page: Page) => {
  const size = page.viewportSize() ?? { width: 800, height: 600 }
  await page.mouse.move(size.width / 2, size.height / 2)
  await page.mouse.move(size.width / 2 + 10, size.height / 2 + 10)
}

/**
 * A catalog tile shows its TMDB poster: served by `/api/v1/images/:id` and really decoded by
 * the browser (`naturalWidth > 0`), not the title-on-a-tone fallback.
 */
export const expectPoster = async (tile: Locator, timeout = 10_000) => {
  const image = tile.locator('img')
  await expect(image).toHaveAttribute('src', /^\/api\/v1\/images\/[^/]+$/, { timeout })
  await image.scrollIntoViewIfNeeded()
  const decodedWidth = () =>
    image.evaluate((element: HTMLImageElement) => (element.complete ? element.naturalWidth : 0))
  await expect.poll(decodedWidth, { timeout }).toBeGreaterThan(0)
}
