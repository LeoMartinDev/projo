import { extensionOf, fileName, MIN_VIDEO_SIZE_BYTES } from '../naming/index.ts'
import type {
  Classification,
  MediaPathAnalysis,
  NamingReviewReason,
  ParsedName,
} from '../naming/index.ts'
import type {
  MatchState,
  NewSource,
  PendingReason,
  SourcePatch,
  SourceSnapshot,
} from '../source/source.ts'

export type FoundFile = {
  rootId: string
  relativePath: string
  sizeBytes: number
  mtimeMs: number
  inode?: string
}

export const fileKey = (rootId: string, relativePath: string): string =>
  `${rootId}\u0000${relativePath}`

export type PlanStats = {
  seen: number
  discovered: number
  pending: number
  ready: number
  missing: number
  moved: number
}

export type ScanPlan = {
  inserts: NewSource[]
  patches: { id: string; patch: SourcePatch }[]
  retest: string[]
  verify: string[]
  moved: string[]
  stats: PlanStats
}

export type PlanInput = {
  libraryId: string
  known: readonly SourceSnapshot[]
  found: readonly FoundFile[]
  now: Date
  full: boolean
  signatures: ReadonlyMap<string, string>
  analyze: (relativePath: string) => MediaPathAnalysis
  newId: () => string
}

const wasReady = (source: SourceSnapshot): boolean =>
  source.readyAt !== undefined && source.pendingReason === undefined

const isSameContent = (source: SourceSnapshot, file: FoundFile): boolean =>
  source.sizeBytes === file.sizeBytes && source.mtimeMs === file.mtimeMs

const quarantineReason = (file: FoundFile): PendingReason =>
  file.sizeBytes < MIN_VIDEO_SIZE_BYTES ? 'too_small' : 'growing'

const statFields = (file: FoundFile): SourcePatch => ({
  sizeBytes: file.sizeBytes,
  mtimeMs: file.mtimeMs,
  inode: file.inode,
})

const quarantine = (source: SourceSnapshot, file: FoundFile, now: Date): SourcePatch => ({
  ...statFields(file),
  state: 'pending',
  pendingReason: quarantineReason(file),
  ...(source.state === 'pending' ? {} : { pendingSince: now }),
  unchangedSince: now,
  stableSince: undefined,
  missingSince: undefined,
})

export const matchStateFor = (
  current: MatchState | undefined,
  reviewReason: NamingReviewReason | undefined,
): MatchState => {
  if (current === 'matched' || current === 'manual') return current
  return reviewReason === undefined ? 'unmatched' : 'needs_review'
}

const namingFields = (
  analysis: MediaPathAnalysis,
  current: Pick<SourceSnapshot, 'state' | 'matchState' | 'classification'> | undefined,
): {
  classification: Classification
  parsed: ParsedName
  matchState: MatchState
  reviewReason: NamingReviewReason | undefined
} => {
  const reclassified =
    current?.matchState === 'matched' && current.classification !== analysis.classification
  const matchState =
    current?.state === 'rejected'
      ? 'unmatched'
      : matchStateFor(reclassified ? undefined : current?.matchState, analysis.reviewReason)
  return {
    classification:
      current?.matchState === 'manual' ? current.classification : analysis.classification,
    parsed: analysis.parsed,
    matchState,
    reviewReason: matchState === 'needs_review' ? analysis.reviewReason : undefined,
  }
}

const stable = (value: unknown): string =>
  typeof value === 'object' && value !== undefined && !Array.isArray(value)
    ? `{${Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, inner]) => `${key}:${stable(inner)}`)
        .join(',')}}`
    : JSON.stringify(value)

const namingChanges = (
  source: SourceSnapshot,
  analysis: MediaPathAnalysis,
): SourcePatch | undefined => {
  const fields = namingFields(analysis, source)
  const same =
    fields.classification === source.classification &&
    fields.matchState === source.matchState &&
    stable(fields.parsed) === stable(source.parsed)
  return same ? undefined : fields
}

export const moveProbeCandidates = (
  known: readonly SourceSnapshot[],
  found: readonly FoundFile[],
): FoundFile[] => {
  const knownKeys = new Set(known.map((s) => fileKey(s.rootId, s.relativePath)))
  const foundKeys = new Set(found.map((f) => fileKey(f.rootId, f.relativePath)))
  const origins = known.filter((s) => !foundKeys.has(fileKey(s.rootId, s.relativePath)))
  const inodes = new Set(origins.flatMap((s) => (s.inode === undefined ? [] : [s.inode])))
  const signedSizes = new Set(
    origins.filter((s) => s.signature !== undefined).map((s) => s.sizeBytes),
  )
  return found.filter(
    (file) =>
      !knownKeys.has(fileKey(file.rootId, file.relativePath)) &&
      file.sizeBytes >= MIN_VIDEO_SIZE_BYTES &&
      !(file.inode !== undefined && inodes.has(file.inode)) &&
      signedSizes.has(file.sizeBytes),
  )
}

export const planScan = ({
  libraryId,
  known,
  found,
  now,
  full,
  signatures,
  analyze,
  newId,
}: PlanInput): ScanPlan => {
  const plan: ScanPlan = {
    inserts: [],
    patches: [],
    retest: [],
    verify: [],
    moved: [],
    stats: { seen: found.length, discovered: 0, pending: 0, ready: 0, missing: 0, moved: 0 },
  }
  const knownByKey = new Map(known.map((s) => [fileKey(s.rootId, s.relativePath), s]))
  const foundKeys = new Set(found.map((f) => fileKey(f.rootId, f.relativePath)))

  const newFiles: FoundFile[] = []
  for (const file of found) {
    const source = knownByKey.get(fileKey(file.rootId, file.relativePath))
    if (source === undefined) {
      newFiles.push(file)
      continue
    }
    const same = isSameContent(source, file)
    switch (source.state) {
      case 'ready':
        if (!same) {
          plan.patches.push({ id: source.id, patch: quarantine(source, file, now) })
          plan.stats.pending += 1
        } else {
          if (source.inode !== file.inode)
            plan.patches.push({ id: source.id, patch: { inode: file.inode } })
          if (full) plan.verify.push(source.id)
        }
        break
      case 'pending':
        if (!same) {
          plan.patches.push({ id: source.id, patch: quarantine(source, file, now) })
          plan.stats.pending += 1
        } else if (
          source.pendingReason === 'probe_failed' ||
          source.pendingReason === 'decode_failed'
        ) {
          plan.retest.push(source.id)
        }
        break
      case 'missing':
        if (same && wasReady(source)) {
          plan.patches.push({
            id: source.id,
            patch: { state: 'ready', missingSince: undefined, inode: file.inode },
          })
          plan.stats.ready += 1
        } else {
          plan.patches.push({ id: source.id, patch: quarantine(source, file, now) })
          plan.stats.pending += 1
        }
        break
      case 'rejected':
        break
    }
    if (full) {
      const naming = namingChanges(source, analyze(file.relativePath))
      if (naming !== undefined) plan.patches.push({ id: source.id, patch: naming })
    }
  }

  const origins = known.filter((s) => !foundKeys.has(fileKey(s.rootId, s.relativePath)))
  const consumed = new Set<string>()
  const takeOrigin = (
    file: FoundFile,
  ): { source: SourceSnapshot; byInode: boolean } | undefined => {
    const byInode = origins.find(
      (s) =>
        !consumed.has(s.id) &&
        file.inode !== undefined &&
        s.inode === file.inode &&
        s.sizeBytes === file.sizeBytes,
    )
    if (byInode !== undefined) return { source: byInode, byInode: true }
    const signature = signatures.get(fileKey(file.rootId, file.relativePath))
    if (signature === undefined) return undefined
    const bySignature = origins.find(
      (s) => !consumed.has(s.id) && s.signature === signature && s.sizeBytes === file.sizeBytes,
    )
    return bySignature === undefined ? undefined : { source: bySignature, byInode: false }
  }

  for (const file of newFiles) {
    const origin = file.sizeBytes >= MIN_VIDEO_SIZE_BYTES ? takeOrigin(file) : undefined
    const analysis = analyze(file.relativePath)
    if (origin !== undefined) {
      const { source, byInode } = origin
      consumed.add(source.id)
      const location: SourcePatch = {
        rootId: file.rootId,
        relativePath: file.relativePath,
        extension: extensionOf(fileName(file.relativePath)),
        ...statFields(file),
        ...namingFields(analysis, source),
      }
      const contentChanged = byInode && source.mtimeMs !== file.mtimeMs
      const stateFields: SourcePatch =
        source.state === 'rejected'
          ? {}
          : contentChanged
            ? quarantine(source, file, now)
            : source.state === 'missing'
              ? wasReady(source)
                ? { state: 'ready', missingSince: undefined }
                : quarantine(source, file, now)
              : {}
      plan.patches.push({ id: source.id, patch: { ...location, ...stateFields } })
      plan.moved.push(source.id)
      plan.stats.moved += 1
      if (stateFields.state === 'pending') plan.stats.pending += 1
      if (stateFields.state === 'ready') plan.stats.ready += 1
      continue
    }
    if (file.sizeBytes < MIN_VIDEO_SIZE_BYTES) continue
    const reviewReason = analysis.reviewReason
    plan.inserts.push({
      id: newId(),
      libraryId,
      rootId: file.rootId,
      relativePath: file.relativePath,
      extension: extensionOf(fileName(file.relativePath)),
      sizeBytes: file.sizeBytes,
      mtimeMs: file.mtimeMs,
      ...(file.inode === undefined ? {} : { inode: file.inode }),
      discoveredAt: now,
      classification: analysis.classification,
      parsed: analysis.parsed,
      matchState: matchStateFor(undefined, reviewReason),
      ...(reviewReason === undefined ? {} : { reviewReason }),
    })
    plan.stats.discovered += 1
    plan.stats.pending += 1
  }

  for (const source of origins) {
    if (consumed.has(source.id)) continue
    if (source.state === 'missing' || source.state === 'rejected') continue
    plan.patches.push({ id: source.id, patch: { state: 'missing', missingSince: now } })
    plan.stats.missing += 1
  }

  return plan
}
