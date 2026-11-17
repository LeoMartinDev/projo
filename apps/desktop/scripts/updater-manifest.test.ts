import { expect, test } from 'bun:test'
import { updaterManifest } from './updater-manifest.ts'

test('points each platform at its file on the release', () => {
  expect(
    updaterManifest({
      version: '0.9.0',
      entries: [
        {
          platform: 'windows-x86_64',
          fileName: 'projo-desktop-0.9.0-setup.exe',
          signature: 'd2luZG93cw==',
        },
        {
          platform: 'darwin-aarch64',
          fileName: 'projo-desktop-0.9.0-macos-arm64.app.tar.gz',
          signature: 'bWFjb3M=',
        },
      ],
      publishedAt: new Date('2026-11-14T10:00:00Z'),
    }),
  ).toEqual({
    version: '0.9.0',
    pub_date: '2026-11-14T10:00:00.000Z',
    platforms: {
      'windows-x86_64': {
        signature: 'd2luZG93cw==',
        url: 'https://github.com/LeoMartinDev/projo/releases/download/desktop-v0.9.0/projo-desktop-0.9.0-setup.exe',
      },
      'darwin-aarch64': {
        signature: 'bWFjb3M=',
        url: 'https://github.com/LeoMartinDev/projo/releases/download/desktop-v0.9.0/projo-desktop-0.9.0-macos-arm64.app.tar.gz',
      },
    },
  })
})
