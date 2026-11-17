// The latest.json that tauri-plugin-updater reads from a desktop release (PRODUCT.md §28.10):
// one entry per platform built (Windows x86_64: the NSIS installer; macOS Apple silicon: the app
// as a .tar.gz), each file hosted on the release desktop-vX.Y.Z itself.

export const REPOSITORY = 'LeoMartinDev/projo'

/** Tauri's platform keys of the targets the app is released for. */
export const updaterPlatforms = ['windows-x86_64', 'darwin-aarch64'] as const
export type UpdaterPlatform = (typeof updaterPlatforms)[number]

/** What one platform's build leaves for the manifest (`updater-<platform>.json`). */
export type UpdaterEntry = { platform: UpdaterPlatform; fileName: string; signature: string }

export type UpdaterManifest = {
  version: string
  pub_date: string
  platforms: Partial<Record<UpdaterPlatform, { signature: string; url: string }>>
}

export const releaseFileUrl = (version: string, fileName: string) =>
  `https://github.com/${REPOSITORY}/releases/download/desktop-v${version}/${fileName}`

export const updaterManifest = ({
  version,
  entries,
  publishedAt,
}: {
  version: string
  entries: readonly UpdaterEntry[]
  publishedAt: Date
}): UpdaterManifest => ({
  version,
  pub_date: publishedAt.toISOString(),
  platforms: Object.fromEntries(
    entries.map(({ platform, fileName, signature }) => [
      platform,
      { signature, url: releaseFileUrl(version, fileName) },
    ]),
  ),
})
