import { z } from 'zod'

// The download page links the latest published desktop release (desktop-vX.Y.Z, PRODUCT.md
// §28.10): the files CI uploads to it, found by name. An older release without a macOS build
// links Windows only.

const desktopReleasesSchema = z.array(
  z.object({
    tag_name: z.string(),
    draft: z.boolean(),
    prerelease: z.boolean(),
    published_at: z.string().nullable(),
    html_url: z.string(),
    assets: z.array(z.object({ name: z.string(), browser_download_url: z.string() })),
  }),
)

export type DesktopDownloads = {
  version: string
  /** The release's page on GitHub (its notes). */
  notes: string
  windows?: string
  macos?: string
}

const TAG = /^desktop-v(\d+)\.(\d+)\.(\d+)$/u

const newer = (a: readonly number[], b: readonly number[]) => {
  for (const [index, part] of a.entries()) {
    const other = b[index] ?? 0
    if (part !== other) return part > other
  }
  return false
}

/** The newest published desktop release that has a download, or none. */
export const toDesktopDownloads = (response: unknown): DesktopDownloads | undefined => {
  const candidates = desktopReleasesSchema.parse(response).flatMap((release) => {
    const match = TAG.exec(release.tag_name) ?? undefined
    if (match === undefined || release.draft || release.prerelease || !release.published_at)
      return []
    const parts = match.slice(1).map(Number)
    const version = parts.join('.')
    const url = (name: string) =>
      release.assets.find((asset) => asset.name === name)?.browser_download_url
    const windows = url(`projo-desktop-${version}-setup.exe`)
    const macos = url(`projo-desktop-${version}-macos-arm64.dmg`)
    if (windows === undefined && macos === undefined) return []
    return [
      {
        parts,
        downloads: {
          version,
          notes: release.html_url,
          ...(windows === undefined ? {} : { windows }),
          ...(macos === undefined ? {} : { macos }),
        },
      },
    ]
  })
  const newest = candidates.reduce<(typeof candidates)[number] | undefined>(
    (best, candidate) =>
      best === undefined || newer(candidate.parts, best.parts) ? candidate : best,
    undefined,
  )
  return newest?.downloads
}
