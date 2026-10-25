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

/** A video file found on disk by the walk, whatever its size. */
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
  /** Pending sources whose probe or decode failed on unchanged bytes: re-tested each scan (§7.3 step 5). */
  retest: string[]
  /** Full scan: ready sources whose signature must be checked again (§7.4 "Scan complet"). */
  verify: string[]
  /** Sources whose path changed (moves): their item links may need a refresh. */
  moved: string[]
  stats: PlanStats
}

export type PlanInput = {
  libraryId: string
  /** Sources of the reachable roots only: an unreachable root's sources are never touched (§7.5). */
  known: readonly SourceSnapshot[]
  found: readonly FoundFile[]
  now: Date
  full: boolean
  /** Signatures of the new files listed by `moveProbeCandidates`, by `fileKey`. */
  signatures: ReadonlyMap<string, string>
  analyze: (relativePath: string) => MediaPathAnalysis
  newId: () => string
}

/** A source that was `ready` and has not changed since (missing keeps the reason it had). */
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

/** §7.3 step 2: back to quarantine, the quiet-period counter restarts now. */
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

/**
 * Naming columns of a (re-)parsed path. An identified source keeps its state and has no review
 * reason; a manual correction also keeps its classification (§7.8: "it's a movie" survives
 * every later scan).
 */
const namingFields = (
  analysis: MediaPathAnalysis,
  current: Pick<SourceSnapshot, 'matchState' | 'classification'> | undefined,
): {
  classification: Classification
  parsed: ParsedName
  matchState: MatchState
  reviewReason: NamingReviewReason | undefined
} => {
  const matchState = matchStateFor(current?.matchState, analysis.reviewReason)
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

/** Naming fields to rewrite when the parse of an unchanged path differs from what is stored. */
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

/** New files that might be moved sources and need a probe to compare signatures (§7.6 step 2). */
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

/**
 * Compares the disk with the `sources` table for one library (§7.2–7.6) and returns what to
 * write. Pure: the caller walks, probes move candidates, then applies the plan in a transaction.
 */
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

  // ── Files still at their path ──────────────────────────────────────────────
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
        // §7.5: back where it was, without loss.
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
        // §7.8: never presented again, except by a full scan.
        if (full) {
          plan.patches.push({
            id: source.id,
            patch: { ...quarantine(source, file, now), pendingSince: now },
          })
          plan.stats.pending += 1
        }
        break
    }
    // A full scan re-reads names too: a new hint or a better parser re-classifies (§7.4).
    if (full) {
      const naming = namingChanges(source, analyze(file.relativePath))
      if (naming !== undefined) plan.patches.push({ id: source.id, patch: naming })
    }
  }

  // ── Moves, then creations (§7.6) ──────────────────────────────────────────
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
      // Same inode but touched since: the bytes may differ, re-check them.
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

  // ── Disappeared (§7.5) ────────────────────────────────────────────────────
  for (const source of origins) {
    if (consumed.has(source.id)) continue
    if (source.state === 'missing' || source.state === 'rejected') continue
    plan.patches.push({ id: source.id, patch: { state: 'missing', missingSince: now } })
    plan.stats.missing += 1
  }

  return plan
}
