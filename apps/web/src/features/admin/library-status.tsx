import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'

import type { LibraryDto, RootErrorReason } from '@projo/shared/api/libraries'
import { isErrorCode } from '@projo/shared/errors'

import { api, request } from '../../shared/api/client.ts'
import { formatDuration, formatNumber, formatPercent } from '../../shared/format/format.ts'
import { currentLocale } from '../../shared/i18n/index.ts'
import { AlertIcon } from '../../shared/ui/icons.tsx'
import { useNow } from '../../shared/ui/use-now.ts'
import { type LiveScan, scanPercent } from './live-scans.ts'
import { librariesQueryKey } from './queries.ts'
import './library-status.css'

type RunningScan = Extract<LiveScan, { status: 'running' }>

/**
 * Where an analysis stands (§7.2–7.3): the scan is requested or walks the roots, then files wait
 * for their quiet period, then they are probed and sample-decoded.
 */
export type AnalysisPhase =
  | { step: 'queued' }
  | { step: 'discovering'; live?: RunningScan }
  | { step: 'waiting'; nextReadyAt?: string }
  | { step: 'verifying' }

/**
 * `ready / total`: ready sources over ready + on their way (waiting or verifying). `failed`:
 * sources that will not get ready on their own, shown apart, never blocking "up to date".
 */
export type LibraryState =
  | { kind: 'analyzing'; phase: AnalysisPhase; ready: number; total: number; failed: number }
  | { kind: 'unreachable'; path: string; reason?: RootErrorReason }
  | { kind: 'failed'; code: string }
  | { kind: 'ok'; failed: number }
  | { kind: 'never' }

/**
 * What the "Status" column shows: a scan (requested, live or unfinished) first, then files still on
 * their way to `ready`, then unreachable roots, the last scan error, and "up to date" only when
 * nothing is in progress.
 */
export const libraryState = (library: LibraryDto, live: LiveScan | undefined): LibraryState => {
  const { ready } = library.sourceCounts
  const { waiting, verifying, failed, nextReadyAt } = library.analysis
  const progress = { ready, total: ready + waiting + verifying, failed }
  const analyzing = (phase: AnalysisPhase): LibraryState => ({
    kind: 'analyzing',
    phase,
    ...progress,
  })

  // A requested scan can finish before the request's answer arrives: the list then shows it done.
  const finishedAt = library.lastScan?.finishedAt
  const stale = live?.status === 'queued' && finishedAt !== undefined && finishedAt >= live.since
  if (live !== undefined && !stale)
    return analyzing(live.status === 'queued' ? { step: 'queued' } : { step: 'discovering', live })
  if (library.lastScan !== undefined && finishedAt === undefined)
    return analyzing({ step: 'discovering' })
  if (verifying > 0) return analyzing({ step: 'verifying' })
  if (waiting > 0)
    return analyzing({ step: 'waiting', ...(nextReadyAt === undefined ? {} : { nextReadyAt }) })

  const unreachable = library.roots.find((root) => root.state === 'unreachable')
  if (unreachable !== undefined)
    return {
      kind: 'unreachable',
      path: unreachable.path,
      ...(unreachable.lastError === undefined ? {} : { reason: unreachable.lastError }),
    }
  if (library.lastScan?.error !== undefined) return { kind: 'failed', code: library.lastScan.error }
  return library.lastScan === undefined ? { kind: 'never' } : { kind: 'ok', failed }
}

/** Why a root is unreachable (§7.5): "Dossier vide"… Generic for a root without a known reason. */
export const rootErrorLabel = (t: TFunction, reason: RootErrorReason | undefined): string =>
  reason === undefined ? t('admin.status.unreachable') : t(`admin.rootError.${reason}`)

/** A scan is requested or walking the roots: no new scan, "Last analysis" reads "in progress". */
export const isScanning = (state: LibraryState): boolean =>
  state.kind === 'analyzing' &&
  (state.phase.step === 'queued' || state.phase.step === 'discovering')

/** Libraries with files on their way to `ready`: their list is refreshed live. */
export const hasAnalysisInProgress = (library: LibraryDto): boolean =>
  library.analysis.waiting + library.analysis.verifying > 0

/** "~2 min" from now; a passed estimate reads as the next minute (the 30 s check, the probe). */
const etaMs = (iso: string, now: Date): number =>
  Math.max(1, Math.ceil((new Date(iso).getTime() - now.getTime()) / 60_000)) * 60_000

/** The phase in one short line, and the unreadable files apart. */
export const AnalysisDetail = ({ state }: { state: LibraryState }) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const now = useNow()
  const phase = (() => {
    if (state.kind !== 'analyzing') return undefined
    const { phase: current } = state
    switch (current.step) {
      case 'queued':
        return t('admin.analysis.discovering')
      case 'discovering':
        return current.live === undefined
          ? t('admin.analysis.discovering')
          : t('admin.analysis.found', {
              count: current.live.stats.seen,
              formatted: formatNumber(current.live.stats.seen, locale),
            })
      case 'waiting': {
        if (current.nextReadyAt === undefined) return t('admin.analysis.waiting')
        const duration = formatDuration(etaMs(current.nextReadyAt, now), locale)
        return state.ready === 0
          ? t('admin.analysis.firstEta', { duration })
          : t('admin.analysis.waitingEta', { duration })
      }
      case 'verifying':
        return t('admin.analysis.verifying')
    }
  })()
  const failed = state.kind === 'analyzing' || state.kind === 'ok' ? state.failed : 0
  return (
    <span className="lib-status__detail">
      {phase}
      {phase !== undefined && failed > 0 ? ' · ' : undefined}
      {failed > 0 ? (
        <span className="lib-status__failed">
          {t('admin.analysis.failed', { count: failed, formatted: formatNumber(failed, locale) })}
        </span>
      ) : undefined}
    </span>
  )
}

const isWalking = (
  phase: AnalysisPhase,
): phase is Extract<AnalysisPhase, { step: 'queued' | 'discovering' }> =>
  phase.step === 'queued' || phase.step === 'discovering'

const walkPercent = (phase: AnalysisPhase): number | undefined =>
  phase.step === 'discovering' ? scanPercent(phase.live) : undefined

/** "12 / 78 ready" once the walk is over; the walk's percentage while it runs, when known. */
export const AnalysisCount = ({
  state,
}: {
  state: Extract<LibraryState, { kind: 'analyzing' }>
}) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  if (isWalking(state.phase)) {
    const percent = walkPercent(state.phase)
    return percent === undefined ? undefined : formatPercent(percent / 100, locale)
  }
  return t('admin.analysis.readyOf', {
    count: state.total,
    ready: formatNumber(state.ready, locale),
    total: formatNumber(state.total, locale),
  })
}

/**
 * The bar of an analysis: the walk while it runs (determinate when the previous walk gives a
 * total), then ready files over ready + on their way. `withCount`: the count beside the bar.
 */
export const AnalysisMeter = ({
  state,
  label,
  withCount = true,
  className = '',
}: {
  state: Extract<LibraryState, { kind: 'analyzing' }>
  label: string
  withCount?: boolean
  className?: string
}) => {
  const percent = walkPercent(state.phase)
  return (
    <span className={`lib-status__progress ${className}`}>
      {isWalking(state.phase) ? (
        percent === undefined ? (
          <span className="indeterminate" aria-hidden="true" />
        ) : (
          <progress className="bar" value={percent} max={100} aria-label={label} />
        )
      ) : (
        <span className="bar-live">
          <progress
            className="bar"
            value={state.ready}
            max={Math.max(1, state.total)}
            aria-label={label}
          />
        </span>
      )}
      {withCount ? (
        <span className="lib-status__count">
          <AnalysisCount state={state} />
        </span>
      ) : undefined}
    </span>
  )
}

/**
 * Three fixed slots (state, bar, detail) whatever the state: a library going from "analyse en
 * cours" to "up to date" keeps its height.
 */
export const LibraryStatus = ({ state }: { state: LibraryState }) => {
  const { t } = useTranslation()
  switch (state.kind) {
    case 'analyzing': {
      const label =
        state.phase.step === 'queued' ? t('admin.status.queued') : t('admin.status.scanning')
      return (
        <div className="lib-status" role="status">
          <span className="lib-status__line lib-status__line--strong">
            <span className="dot dot--busy" aria-hidden="true" />
            {label}
          </span>
          <AnalysisMeter state={state} label={label} />
          <AnalysisDetail state={state} />
        </div>
      )
    }
    case 'unreachable':
      return (
        <div className="lib-status">
          <span className="lib-status__line lib-status__line--error">
            <AlertIcon size={15} />
            {rootErrorLabel(t, state.reason)}
          </span>
          <span className="lib-status__detail mono">{state.path}</span>
        </div>
      )
    case 'failed':
      return (
        <div className="lib-status">
          <span className="lib-status__line lib-status__line--error">
            <AlertIcon size={15} />
            {t('admin.status.failed')}
          </span>
          <span className="lib-status__detail">
            {isErrorCode(state.code) ? t(`errors.${state.code}`) : state.code}
          </span>
        </div>
      )
    case 'ok':
      return (
        <div className="lib-status" role="status">
          <span className="lib-status__line">
            <span className="dot dot--ok" aria-hidden="true" />
            {t('admin.status.ok')}
          </span>
          {state.failed > 0 ? <AnalysisDetail state={state} /> : undefined}
        </div>
      )
    case 'never':
      return (
        <div className="lib-status">
          <span className="lib-status__line">
            <span className="dot" aria-hidden="true" />
            {t('admin.status.never')}
          </span>
        </div>
      )
  }
}

/** `POST /admin/libraries/:id/scan` (`quick` or `full`, §7.4). */
export const useScanLibrary = (onQueued: (libraryId: string, requestedAt: string) => void) => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, mode }: { id: string; mode: 'quick' | 'full' }) =>
      request(() => api.admin.libraries[':id'].scan.$post({ param: { id }, json: { mode } })),
    // Taken before the request: a fast scan may finish before the answer arrives.
    onMutate: () => ({ requestedAt: new Date().toISOString() }),
    onSuccess: (_result, { id }, context) => {
      onQueued(id, context.requestedAt)
      void queryClient.invalidateQueries({ queryKey: librariesQueryKey })
    },
  })
}
