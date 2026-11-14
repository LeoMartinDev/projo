// The latest.json that tauri-plugin-updater reads from a desktop release (PRODUCT.md §28.10):
// Windows x86_64 only, the installer hosted on the release desktop-vX.Y.Z itself.

export const REPOSITORY = 'LeoMartinDev/projo'

export type UpdaterManifest = {
  version: string
  pub_date: string
  platforms: Record<string, { signature: string; url: string }>
}

export const updaterManifest = ({
  version,
  fileName,
  signature,
  publishedAt,
}: {
  version: string
  fileName: string
  signature: string
  publishedAt: Date
}): UpdaterManifest => ({
  version,
  pub_date: publishedAt.toISOString(),
  platforms: {
    'windows-x86_64': {
      signature,
      url: `https://github.com/${REPOSITORY}/releases/download/desktop-v${version}/${fileName}`,
    },
  },
})
