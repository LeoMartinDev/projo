import type { AppError, Result } from '@projo/shared'

export type TvLogoType = 'png' | 'jpg' | 'webp' | 'gif'

export type TvLogo = { bytes: Uint8Array; type: TvLogoType }

export type TvLogoError = AppError<'tv/logo_unavailable'>

/** Largest logo downloaded (§29.2). */
export const TV_LOGO_MAX_BYTES = 1024 * 1024

const startsWith = (bytes: Uint8Array, prefix: readonly number[], offset = 0): boolean =>
  bytes.length >= offset + prefix.length &&
  prefix.every((byte, index) => bytes[offset + index] === byte)

/** The image type by its magic signature; SVG and anything else are refused (§29.2). */
export const tvLogoTypeOf = (bytes: Uint8Array): TvLogoType | undefined => {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpg'
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return 'webp'
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return 'gif'
  return undefined
}

const contentTypes: Record<TvLogoType, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

export const tvLogoContentType = (path: string): string => {
  const extension = path.slice(path.lastIndexOf('.') + 1)
  return extension in contentTypes
    ? contentTypes[extension as TvLogoType]
    : 'application/octet-stream'
}

export const tvLogoPathOf = (channelId: string, type: TvLogoType): string =>
  `tv/${channelId}.${type}`

export type TvLogoDownloader = {
  download: (input: {
    url: string
    userAgent?: string
    signal?: AbortSignal
  }) => Promise<Result<TvLogo, TvLogoError>>
}

/** Logo files under the images directory; paths are relative to it. */
export type TvLogoFiles = {
  write: (input: { path: string; bytes: Uint8Array }) => Promise<Result<void, TvLogoError>>
  remove: (path: string) => Promise<void>
  absolutePath: (path: string) => string
}
