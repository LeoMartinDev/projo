import { expect, test } from 'bun:test'

import { toDesktopDownloads } from './desktop.ts'

const release = (
  tag: string,
  assets: string[],
  { draft = false, prerelease = false, published = true } = {},
) => ({
  tag_name: tag,
  draft,
  prerelease,
  published_at: published ? '2026-11-17T10:00:00Z' : JSON.parse('null'),
  html_url: `https://github.com/LeoMartinDev/projo/releases/tag/${tag}`,
  assets: assets.map((name) => ({
    name,
    browser_download_url: `https://github.com/LeoMartinDev/projo/releases/download/${tag}/${name}`,
  })),
})

test('links the newest desktop release, Windows and macOS', () => {
  expect(
    toDesktopDownloads([
      release('v1.28.0', ['projo-app-1.28.0.tar.gz']),
      release('desktop-v0.8.3', ['projo-desktop-0.8.3-setup.exe', 'latest.json']),
      release('desktop-v0.10.0', [
        'projo-desktop-0.10.0-setup.exe',
        'projo-desktop-0.10.0-macos-arm64.dmg',
        'projo-desktop-0.10.0-macos-arm64.app.tar.gz',
        'latest.json',
      ]),
      release('desktop-v0.9.0', ['projo-desktop-0.9.0-setup.exe']),
    ]),
  ).toEqual({
    version: '0.10.0',
    notes: 'https://github.com/LeoMartinDev/projo/releases/tag/desktop-v0.10.0',
    windows:
      'https://github.com/LeoMartinDev/projo/releases/download/desktop-v0.10.0/projo-desktop-0.10.0-setup.exe',
    macos:
      'https://github.com/LeoMartinDev/projo/releases/download/desktop-v0.10.0/projo-desktop-0.10.0-macos-arm64.dmg',
  })
})

test('an older release links Windows only', () => {
  expect(
    toDesktopDownloads([release('desktop-v0.8.3', ['projo-desktop-0.8.3-setup.exe'])]),
  ).toEqual({
    version: '0.8.3',
    notes: 'https://github.com/LeoMartinDev/projo/releases/tag/desktop-v0.8.3',
    windows:
      'https://github.com/LeoMartinDev/projo/releases/download/desktop-v0.8.3/projo-desktop-0.8.3-setup.exe',
  })
})

test('drafts, pre-releases and releases without a download are left out', () => {
  expect(
    toDesktopDownloads([
      release('desktop-v0.9.0', ['projo-desktop-0.9.0-setup.exe'], { draft: true }),
      release('desktop-v0.9.1-rc.1', ['projo-desktop-0.9.1-rc.1-setup.exe']),
      release('desktop-v0.9.2', ['projo-desktop-0.9.2-setup.exe'], { prerelease: true }),
      release('desktop-v0.9.3', ['latest.json']),
      release('v1.28.0', ['projo-app-1.28.0.tar.gz']),
    ]),
  ).toBeUndefined()
})
