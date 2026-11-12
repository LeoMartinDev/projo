import type { JobPayloads, JobType } from './job.ts'
import type { JobTargetRef } from './ports.ts'

const stringField = (payload: unknown, key: string): string | undefined => {
  if (typeof payload !== 'object' || !payload) return undefined
  const value: unknown = Reflect.get(payload, key)
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** Field names of a payload, of each member for a union (a renamed field must be renamed here). */
type PayloadField<P> = P extends unknown ? keyof P & string : never

const targetKinds: {
  [T in JobType]: readonly (readonly [JobTargetRef['kind'], PayloadField<JobPayloads[T]>])[]
} = {
  scan_library: [['library', 'libraryId']],
  watch_pending: [],
  probe_source: [['source', 'sourceId']],
  match_source: [['source', 'sourceId']],
  fetch_images: [['item', 'itemId']],
  index_keyframes: [['source', 'sourceId']],
  fetch_segments: [['item', 'itemId']],
  fingerprint_season: [['season', 'seasonId']],
  submit_segment: [['item', 'itemId']],
  trickplay: [['source', 'sourceId']],
  preview_clip: [['item', 'itemId']],
  extract_subtitles: [['source', 'sourceId']],
  refresh_metadata: [
    ['item', 'itemId'],
    ['library', 'libraryId'],
  ],
  check_updates: [],
  apply_update: [['version', 'version']],
  cleanup_cache: [],
  purge_missing: [],
  image_variants: [],
}

export const jobTargetOf = (type: JobType, payload: unknown): JobTargetRef | undefined => {
  for (const [kind, field] of targetKinds[type]) {
    const id = stringField(payload, field)
    if (id !== undefined) return { kind, id }
  }
  return undefined
}
