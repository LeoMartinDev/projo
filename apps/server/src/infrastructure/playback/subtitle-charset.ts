export type SubtitleCharset = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252'

const startsWith = (bytes: Uint8Array, prefix: readonly number[]): boolean =>
  prefix.every((byte, i) => bytes[i] === byte)

const isValidUtf8 = (bytes: Uint8Array): boolean => {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

export const detectSubtitleCharset = (bytes: Uint8Array): SubtitleCharset => {
  if (startsWith(bytes, [0xef, 0xbb, 0xbf])) return 'utf-8'
  if (startsWith(bytes, [0xff, 0xfe])) return 'utf-16le'
  if (startsWith(bytes, [0xfe, 0xff])) return 'utf-16be'
  return isValidUtf8(bytes) ? 'utf-8' : 'windows-1252'
}

export const decodeSubtitle = (bytes: Uint8Array, charset: SubtitleCharset): string =>
  new TextDecoder(charset).decode(bytes)
