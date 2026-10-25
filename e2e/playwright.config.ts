import { defineConfig, devices } from '@playwright/test'

import type { ServerOptions } from './support/fixtures.ts'
import { baseUrlOf, servers, type ServerName } from './support/paths.ts'

const ci = process.env['CI'] !== undefined && process.env['CI'] !== ''

const browsers: Record<ServerName, (typeof devices)[string]> = {
  chromium: devices['Desktop Chrome'],
  webkit: devices['Desktop Safari'],
}

/** The journey that sets a server up (wizard, library, TMDB key): every other one needs it. */
const firstLaunch = /first-launch\.e2e\.ts$/

/**
 * iPhone (§23 M3): WebKit with the iPhone viewport, touch and user agent, on the WebKit server,
 * for the journeys tagged `@mobile`, once the desktop WebKit journeys are done.
 */
const iphone = {
  name: 'webkit-iphone',
  server: 'webkit',
  device: devices['iPhone 15'],
  after: 'webkit',
} as const

/**
 * E2E (PRODUCT.md §22): each browser gets its own real server (built bundle, fresh DATA_DIR,
 * recorded TMDB) and its own library folder, so both run every journey. Per browser, the
 * first-launch project runs first, then the other journeys one file at a time. `bun run e2e`
 * builds the bundle first.
 */
export default defineConfig<object, ServerOptions>({
  testDir: './tests',
  testMatch: '**/*.e2e.ts',
  outputDir: './test-results',
  globalSetup: './global-setup.ts',
  // A journey mutates its server (setup, library, progress): no retry, no parallelism inside a
  // browser (`workers: 1` per project). The two browsers run side by side on their own server.
  fullyParallel: false,
  workers: Object.keys(servers).length,
  retries: 0,
  forbidOnly: ci,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: ci
    ? [['github'], ['list'], ['html', { open: 'never', outputFolder: './playwright-report' }]]
    : [['list'], ['html', { open: 'never', outputFolder: './playwright-report' }]],
  use: {
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    ...(Object.keys(browsers) as ServerName[]).flatMap((name) => {
      const use = { ...browsers[name], baseURL: baseUrlOf(name), serverName: name }
      return [
        { name: `${name}-first-launch`, testMatch: firstLaunch, workers: 1, use },
        {
          name,
          testIgnore: firstLaunch,
          dependencies: [`${name}-first-launch`],
          workers: 1,
          use,
        },
      ]
    }),
    {
      name: iphone.name,
      grep: /@mobile/,
      testIgnore: firstLaunch,
      dependencies: [iphone.after],
      workers: 1,
      use: { ...iphone.device, baseURL: baseUrlOf(iphone.server), serverName: iphone.server },
    },
  ],
  webServer: (Object.keys(servers) as ServerName[]).map((name) => ({
    command: `bun scripts/serve.ts ${name}`,
    url: `${baseUrlOf(name)}/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10_000 },
  })),
})
