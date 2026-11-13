import type { PlayableSource } from '../../../core/catalog/catalog.ts'
import type { FileFingerprint } from '../../../core/playback/media-assets.ts'

export const sourceFingerprint = (source: PlayableSource): FileFingerprint => ({
  sizeBytes: source.sizeBytes,
  mtimeMs: source.mtime,
})
