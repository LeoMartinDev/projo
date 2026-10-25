import type { UploadedImageType } from './editing.ts'

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean =>
  bytes.length >= offset + signature.length &&
  signature.every((byte, index) => bytes[offset + index] === byte)

const JPEG = [0xff, 0xd8, 0xff] as const
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const
/** `RIFF` … `WEBP`. */
const RIFF = [0x52, 0x49, 0x46, 0x46] as const
const WEBP = [0x57, 0x45, 0x42, 0x50] as const

/**
 * Type of an uploaded image by its magic bytes (§20), never by its name or declared MIME type.
 * `undefined`: not JPEG, PNG or WebP.
 */
export const detectImageType = (bytes: Uint8Array): UploadedImageType | undefined => {
  if (startsWith(bytes, JPEG)) return 'jpeg'
  if (startsWith(bytes, PNG)) return 'png'
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) return 'webp'
  return undefined
}
