import { defineConfig, devices } from '@playwright/test'

import { baseUrl } from './support/paths.ts'

const ci = process.env['CI'] !== undefined && process.env['CI'] !== ''

/** The journey that sets the server up (wizard, library, TMDB key): every other one needs it. */
const firstLaunch = /first-launch\.e2e\.ts$/

/**
 * E2E (PRODUCT.md §22): one real server (built bundle, fresh DATA_DIR, recorded TMDB), the
 * journeys one at a time. Chromium runs every journey, the first-launch one first. Then a WebKit
 * smoke test: desktop Safari for the journeys tagged `@webkit`, the iPhone viewport, touch and
 * user agent for those tagged `@mobile` (§23 M3). `bun run e2e` builds the bundle first.
 */
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.e2e.ts',
  outputDir: './test-results',
  globalSetup: './global-setup.ts',
  // A journey mutates the server (setup, library, progress): no retry, no parallelism. One
  // browser and one ffmpeg at a time keep the timings of a loaded CI runner predictable.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: ci,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: ci
    ? [['github'], ['list'], ['html', { open: 'never', outputFolder: './playwright-report' }]]
    : [['list'], ['html', { open: 'never', outputFolder: './playwright-report' }]],
  use: {
    baseURL: baseUrl,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'first-launch', testMatch: firstLaunch, use: devices['Desktop Chrome'] },
    {
      name: 'chromium',
      testIgnore: firstLaunch,
      dependencies: ['first-launch'],
      use: devices['Desktop Chrome'],
    },
    {
      name: 'webkit',
      grep: /@webkit/,
      testIgnore: firstLaunch,
      dependencies: ['chromium'],
      use: devices['Desktop Safari'],
    },
    {
      name: 'webkit-iphone',
      grep: /@mobile/,
      testIgnore: firstLaunch,
      dependencies: ['webkit'],
      use: devices['iPhone 15'],
    },
  ],
  webServer: {
    command: 'bun scripts/serve.ts',
    url: `${baseUrl}/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
  },
})
