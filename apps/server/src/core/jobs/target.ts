import type { JobType } from './job.ts'
import type { JobTargetRef } from './ports.ts'

const stringField = (payload: unknown, key: string): string | undefined => {
  if (typeof payload !== 'object' || !payload) return undefined
  const value: unknown = Reflect.get(payload, key)
  return typeof value === 'string' && value !== '' ? value : undefined
}

const targetKinds: Record<JobType, readonly (readonly [JobTargetRef['kind'], string])[]> = {
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
  // One item, or a whole library ("Refresh the whole library").
  refresh_metadata: [
    ['item', 'itemId'],
    ['library', 'libraryId'],
  ],
  check_updates: [],
  apply_update: [['version', 'version']],
  cleanup_cache: [],
  purge_missing: [],
}

/**
 * "Cible" of a job (§15), read from its payload: the first field of its type that is set.
 * `undefined` for the jobs without a subject (`watch_pending`, `check_updates`, `cleanup_cache`,
 * `purge_missing`) and for a payload that does not carry the expected field.
 */
export const jobTargetOf = (type: JobType, payload: unknown): JobTargetRef | undefined => {
  for (const [kind, field] of targetKinds[type]) {
    const id = stringField(payload, field)
    if (id !== undefined) return { kind, id }
  }
  return undefined
}
