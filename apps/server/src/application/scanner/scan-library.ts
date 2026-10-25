import { appError, type AppError, err, ok, type Result } from '@projo/shared'

import type { Clock } from '../../core/clock.ts'
import type { EventBus } from '../../core/events.ts'
import type { FileSystem } from '../../core/fs/file-system.ts'
import type { IdGenerator } from '../../core/ids.ts'
import type { JobQueue } from '../../core/jobs/ports.ts'
import type { Library, LibraryRepository, LibraryRoot } from '../../core/library/library.ts'
import { joinAbsolute } from '../../core/library/roots.ts'
import type { Logger } from '../../core/logger.ts'
import { type MediaProber, signatureOf } from '../../core/media/probe.ts'
import type { MatchRequester } from '../../core/metadata/ports.ts'
import { analyzeMediaPath } from '../../core/naming/index.ts'
import {
  type AdminNotifier,
  emptyScanStats,
  isFullScan,
  type ScanKind,
  type ScanPhase,
  type ScanRun,
  type ScanRunRepository,
} from '../../core/scanner/ports.ts'
import {
  assessRootContent,
  assessRootStat,
  type RootAssessment,
} from '../../core/scanner/root-guard.ts'
import {
  fileKey,
  type FoundFile,
  moveProbeCandidates,
  planScan,
} from '../../core/scanner/scan-plan.ts'
import { planExternalSubtitles, planStacks } from '../../core/scanner/sync.ts'
import type { SourceRepository, SourceSnapshot } from '../../core/source/source.ts'
import type { LinkSourceItems } from './link-source-items.ts'
import type { WalkResult, WalkRoot } from './walk-root.ts'

type Deps = {
  libraryRepository: LibraryRepository
  sourceRepository: SourceRepository
  scanRunRepository: ScanRunRepository
  walkRoot: WalkRoot
  fileSystem: FileSystem
  prober: MediaProber
  linkSourceItems: LinkSourceItems
  /** §7.4 full scan: "retry matching of `unmatched` ones"; moved sources too. */
  requestMatch: MatchRequester
  notifier: AdminNotifier
  jobQueue: JobQueue
  eventBus: EventBus
  clock: Clock
  ids: IdGenerator
  logger: Logger
}

export type ScanLibraryInput = {
  libraryId: string
  kind: ScanKind
  signal?: AbortSignal
  /** 0..100 for the job row. */
  reportProgress?: (progress: number) => void
}

export type ScanReport = {
  run: ScanRun
  /** Roots skipped by the §7.5 guard. */
  unreachableRoots: string[]
}

export type ScanLibraryError = AppError<'library/not_found'>

/** Above this, moved files are not probed during the scan: they go through the normal pipeline. */
const MAX_MOVE_PROBES = 50
const PROGRESS_EVERY_MS = 500

const isUnder = (relativePath: string, directory: string): boolean =>
  directory === '' || relativePath === directory || relativePath.startsWith(`${directory}/`)

/**
 * Files the walk should see: the last complete walk of every root, `undefined` when one was never
 * walked (first scan, new root) and the bar stays indeterminate.
 */
const expectedFileCount = (roots: readonly LibraryRoot[]): number | undefined =>
  roots.every((root) => root.lastScanAt !== undefined)
    ? roots.reduce((sum, root) => sum + root.lastFileCount, 0)
    : undefined

/**
 * One scan of a library (§7.2–7.7), job `scan_library`. Per root: §7.5 guard, walk, then one
 * plan for the whole library (moves may cross roots), applied in one transaction. Then parts,
 * external subtitles, item links of moved sources, probes to re-run. New files enter quarantine:
 * `watch_pending` and `probe_source` take them to `ready`.
 */
export const scanLibraryFactory = (deps: Deps) => {
  const {
    libraryRepository,
    sourceRepository,
    scanRunRepository,
    walkRoot,
    fileSystem,
    prober,
    linkSourceItems,
    requestMatch,
    notifier,
    jobQueue,
    eventBus,
    clock,
    ids,
    logger,
  } = deps

  const markUnreachable = (
    root: LibraryRoot,
    assessment: RootAssessment & { kind: 'unreachable' },
  ) => {
    libraryRepository.markRootUnreachable({
      rootId: root.id,
      at: clock.now(),
      reason: assessment.reason,
    })
    notifier.notify({
      kind: 'library/root_unreachable',
      severity: 'error',
      key: root.id,
      context: {
        libraryId: root.libraryId,
        rootId: root.id,
        path: root.path,
        reason: assessment.reason,
      },
    })
    logger.warn('library root unreachable, scan of this root skipped', {
      code: 'library/root_unreachable',
      libraryId: root.libraryId,
      rootId: root.id,
      path: root.path,
      reason: assessment.reason,
      detail: assessment.message,
    })
  }

  const signaturesFor = async (
    known: readonly SourceSnapshot[],
    found: readonly FoundFile[],
    rootPaths: ReadonlyMap<string, string>,
    signal: AbortSignal | undefined,
  ): Promise<Map<string, string>> => {
    const signatures = new Map<string, string>()
    for (const file of moveProbeCandidates(known, found).slice(0, MAX_MOVE_PROBES)) {
      const rootPath = rootPaths.get(file.rootId)
      if (rootPath === undefined) continue
      const probe = await prober.probe({
        path: joinAbsolute(rootPath, file.relativePath),
        ...(signal === undefined ? {} : { signal }),
      })
      if (probe.ok)
        signatures.set(
          fileKey(file.rootId, file.relativePath),
          signatureOf(file.sizeBytes, probe.value),
        )
    }
    return signatures
  }

  const relink = (ids: readonly string[]) => {
    for (const id of ids) {
      const source = sourceRepository.findById(id)
      if (source === undefined || source.state !== 'ready') continue
      linkSourceItems(source)
      if (source.matchState === 'unmatched' || source.matchState === 'needs_review') {
        requestMatch({ sourceId: source.id })
      }
    }
  }

  return async ({
    libraryId,
    kind,
    signal,
    reportProgress,
  }: ScanLibraryInput): Promise<Result<ScanReport, ScanLibraryError>> => {
    const library: Library | undefined = libraryRepository.findById(libraryId)
    if (library === undefined) {
      return err(appError('library/not_found', 'library not found', { context: { libraryId } }))
    }
    const full = isFullScan(kind)
    const run = scanRunRepository.start({ id: ids.next(), libraryId, kind, startedAt: clock.now() })
    const stats = emptyScanStats()
    const log = logger.child({ libraryId, scanRunId: run.id, scanKind: kind })
    let lastProgressAt = 0
    let phase: ScanPhase = 'discovering'
    let expected = expectedFileCount(library.roots)
    const publishProgress = (force = false) => {
      const now = clock.now().getTime()
      if (!force && now - lastProgressAt < PROGRESS_EVERY_MS) return
      lastProgressAt = now
      const total = phase === 'processing' ? stats.seen : expected
      eventBus.publish('scan.progress', {
        libraryId,
        scanRunId: run.id,
        stats: { ...stats },
        phase,
        ...(total === undefined ? {} : { total }),
      })
      // The walk is most of the work: 0..60 of the job progress.
      if (phase === 'discovering' && expected !== undefined && expected > 0)
        reportProgress?.(Math.min(60, Math.round((stats.seen / expected) * 60)))
    }
    publishProgress(true)

    // ── Walk each root behind the §7.5 guard ───────────────────────────────
    const walks: { root: LibraryRoot; walk: WalkResult }[] = []
    const unreachableRoots: string[] = []
    let seenBefore = 0
    for (const [index, root] of library.roots.entries()) {
      const assessment = assessRootStat(await fileSystem.stat(root.path))
      if (assessment.kind === 'unreachable') {
        markUnreachable(root, assessment)
        unreachableRoots.push(root.id)
        stats.errors += 1
        if (expected !== undefined) expected -= root.lastFileCount
        continue
      }
      const walk = await walkRoot({
        rootId: root.id,
        rootPath: root.path,
        incremental: !full,
        ...(signal === undefined ? {} : { signal }),
        onProgress: (seen) => {
          stats.seen = seenBefore + seen
          publishProgress()
        },
      })
      if (walk.aborted) {
        const finished = scanRunRepository.finish({
          id: run.id,
          finishedAt: clock.now(),
          stats,
          error: 'job/cancelled',
        })
        return ok({ run: finished, unreachableRoots })
      }
      seenBefore += walk.videos.length
      stats.errors += walk.errors
      const content = assessRootContent({
        entryCount: walk.rootEntryCount,
        videoCount: walk.videos.length,
        lastFileCount: root.lastFileCount,
      })
      if (content.kind === 'unreachable') {
        markUnreachable(root, content)
        unreachableRoots.push(root.id)
        stats.errors += 1
        continue
      }
      walks.push({ root, walk })
      reportProgress?.(Math.round(((index + 1) / library.roots.length) * 60))
    }
    phase = 'processing'

    // ── Plan and apply (§7.4–7.6) ──────────────────────────────────────────
    const reachable = new Map(walks.map(({ root, walk }) => [root.id, walk]))
    const rootPaths = new Map(library.roots.map((root) => [root.id, root.path]))
    const knownNow = () =>
      sourceRepository.listSnapshots(libraryId).filter((source) => {
        const walk = reachable.get(source.rootId)
        if (walk === undefined) return false
        return (
          !walk.failedDirectories.some((directory) => isUnder(source.relativePath, directory)) &&
          !walk.failedFiles.includes(source.relativePath)
        )
      })
    const found = walks.flatMap(({ walk }) => walk.videos)
    const signatures = await signaturesFor(knownNow(), found, rootPaths, signal)
    // Read again after the last await: plan and apply run without yielding to other jobs.
    const known = knownNow()
    const plan = planScan({
      libraryId,
      known,
      found,
      now: clock.now(),
      full,
      signatures,
      analyze: (relativePath) => analyzeMediaPath({ relativePath, hint: library.hint }),
      newId: () => ids.next(),
    })
    sourceRepository.applyChanges({ inserts: plan.inserts, patches: plan.patches })
    stats.seen = plan.stats.seen
    stats.discovered = plan.stats.discovered
    stats.pending = plan.stats.pending
    stats.ready = plan.stats.ready
    stats.missing = plan.stats.missing
    stats.moved = plan.stats.moved
    publishProgress(true)
    reportProgress?.(75)

    for (const { root, walk } of walks) {
      libraryRepository.markRootScanned({
        rootId: root.id,
        at: clock.now(),
        fileCount: walk.videos.length,
      })
      notifier.resolve({ kind: 'library/root_unreachable', key: root.id })
      for (const folder of walk.unsupportedLayouts) {
        notifier.notify({
          kind: 'scan/unsupported_layout',
          severity: 'warning',
          key: `${root.id}:${folder}`,
          context: { libraryId, rootId: root.id, path: joinAbsolute(root.path, folder) },
        })
      }
    }

    // ── Parts, subtitles, links (§7.7, §8.3, §8.4) ─────────────────────────
    const snapshots = sourceRepository
      .listSnapshots(libraryId)
      .filter((source) => reachable.has(source.rootId))
    const stackPatches = planStacks(snapshots)
    sourceRepository.applyChanges({ inserts: [], patches: stackPatches })
    const currentSubtitles = sourceRepository.externalSubtitlesByLibrary(libraryId)
    for (const { root, walk } of walks) {
      const replacements = planExternalSubtitles({
        rootPath: root.path,
        sources: snapshots.filter((source) => source.rootId === root.id),
        subtitlePaths: walk.subtitles,
        current: currentSubtitles,
      })
      for (const { sourceId, rows } of replacements) {
        sourceRepository.replaceExternalSubtitles(sourceId, rows)
      }
    }
    // Moved or re-stacked ready sources may now belong elsewhere; a full scan relinks every ready one.
    const relinkIds = full
      ? snapshots.filter((source) => source.state === 'ready').map((source) => source.id)
      : [...plan.moved, ...stackPatches.map((change) => change.id)]
    relink([...new Set(relinkIds)])

    // ── Probes to (re)run ──────────────────────────────────────────────────
    for (const sourceId of plan.retest) {
      jobQueue.enqueue({
        type: 'probe_source',
        payload: { sourceId, mode: 'quarantine' },
        dedupeKey: `source:${sourceId}`,
      })
    }
    for (const sourceId of plan.verify) {
      jobQueue.enqueue({
        type: 'probe_source',
        payload: { sourceId, mode: 'verify' },
        dedupeKey: `source:${sourceId}`,
        priority: 30,
      })
    }
    reportProgress?.(100)

    const error = unreachableRoots.length > 0 ? 'library/root_unreachable' : undefined
    const finished = scanRunRepository.finish({
      id: run.id,
      finishedAt: clock.now(),
      stats,
      ...(error === undefined ? {} : { error }),
    })
    eventBus.publish('scan.finished', {
      libraryId,
      scanRunId: run.id,
      stats: { ...stats },
      ...(error === undefined
        ? {}
        : {
            error: {
              code: 'library/root_unreachable' as const,
              message: `${unreachableRoots.length} root(s) unreachable`,
            },
          }),
    })
    log.info('library scanned', { stats, unreachableRoots: unreachableRoots.length })
    return ok({ run: finished, unreachableRoots })
  }
}

export type ScanLibrary = ReturnType<typeof scanLibraryFactory>
