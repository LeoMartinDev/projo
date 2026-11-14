import { expect, test } from 'bun:test'
import { updaterManifest } from './updater-manifest.ts'

test('points the Windows x86_64 entry at the installer of the release', () => {
  expect(
    updaterManifest({
      version: '0.3.1',
      fileName: 'projo-desktop-0.3.1-setup.exe',
      signature: 'c2lnbmF0dXJl',
      publishedAt: new Date('2026-11-14T10:00:00Z'),
    }),
  ).toEqual({
    version: '0.3.1',
    pub_date: '2026-11-14T10:00:00.000Z',
    platforms: {
      'windows-x86_64': {
        signature: 'c2lnbmF0dXJl',
        url: 'https://github.com/LeoMartinDev/projo/releases/download/desktop-v0.3.1/projo-desktop-0.3.1-setup.exe',
      },
    },
  })
})
