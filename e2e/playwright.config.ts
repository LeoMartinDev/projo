import { defineConfig, devices } from '@playwright/test'

import { baseUrl } from './support/paths.ts'

const ci = process.env['CI'] !== undefined && process.env['CI'] !== ''

const firstLaunch = /first-launch\.e2e\.ts$/

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.e2e.ts',
  outputDir: './test-results',
  globalSetup: './global-setup.ts',
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
