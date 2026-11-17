import { expect, test } from 'bun:test'

import { en } from '../i18n/messages.ts'
import { renderDownloads } from './render.ts'

const release = 'https://github.com/LeoMartinDev/projo/releases/download/desktop-v0.10.0'

test('links each platform, with macOS first-launch steps', () => {
  const html = renderDownloads(
    {
      version: '0.10.0',
      notes: 'https://github.com/LeoMartinDev/projo/releases/tag/desktop-v0.10.0',
      windows: `${release}/projo-desktop-0.10.0-setup.exe`,
      macos: `${release}/projo-desktop-0.10.0-macos-arm64.dmg`,
    },
    en.download,
  )
  expect(html).toContain(`href="${release}/projo-desktop-0.10.0-setup.exe"`)
  expect(html).toContain(`href="${release}/projo-desktop-0.10.0-macos-arm64.dmg"`)
  expect(html).toContain(en.download.macos.firstLaunch)
  expect(html).toContain('Version 0.10.0')
})

test('a platform without a build is shown as coming, without steps', () => {
  const html = renderDownloads(
    {
      version: '0.8.3',
      notes: 'https://github.com/LeoMartinDev/projo/releases/tag/desktop-v0.8.3',
      windows: `${release}/projo-desktop-0.8.3-setup.exe`,
    },
    en.download,
  )
  expect(html).toContain(
    `<span class="button" aria-disabled="true">${en.download.unavailable}</span>`,
  )
  expect(html).not.toContain(en.download.macos.firstLaunch)
})

test('no desktop release: a link to GitHub', () => {
  expect(renderDownloads(undefined, en.download)).toContain(en.download.empty)
})
