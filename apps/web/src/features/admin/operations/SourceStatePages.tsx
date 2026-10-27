import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { itemWithSeriesLabel } from '@projo/i18n/item-titles'
import type { SourceDto } from '@projo/shared/api/libraries'

import { api, request } from '../../../shared/api/client.ts'
import {
  formatBytes,
  formatDateTime,
  formatNumber,
  formatRelative,
} from '../../../shared/format/format.ts'
import { currentLocale } from '../../../shared/i18n/index.ts'
import { Dialog } from '../../../shared/ui/Dialog.tsx'
import { EyeIcon, EyeOffIcon } from '../../../shared/ui/icons.tsx'
import { EmptyState, ErrorAlert, ErrorState } from '../../../shared/ui/states.tsx'
import { useNow } from '../../../shared/ui/use-now.ts'
import { reviewQueryKey } from '../identify/queries.ts'
import { HideSourceDialog } from '../review/HideSourceDialog.tsx'
import { fileName } from '../review/parsed.ts'
import {
  sourcesByStateQuery,
  sourcesByStateQueryKey,
  statsQueryKey,
  useLiveSources,
} from './queries.ts'
import '../admin.css'
import '../admin-table.css'
import './operations.css'

const SkeletonRows = () => (
  <>
    {[0, 1, 2, 3].map((index) => (
      <div key={index} className="adm-tr adm-tr--skeleton" aria-hidden="true">
        <span className="skeleton skeleton--line" />
      </div>
    ))}
  </>
)

const Ago = ({ iso }: { iso: string | undefined }) => {
  const locale = currentLocale()
  const now = useNow()
  if (iso === undefined) return <span className="adm-muted">—</span>
  return (
    <span className="adm-muted" title={formatDateTime(iso, locale)}>
      {formatRelative(iso, locale, now)}
    </span>
  )
}

/** File name, then the full path (ellipsis at the start). */
const FileCell = ({ source }: { source: SourceDto }) => (
  <div className="adm-cell" role="cell">
    <span className="adm-strong" title={source.relativePath}>
      {fileName(source.relativePath)}
    </span>
    <span className="adm-muted adm-path adm-mono" title={source.path}>
      <bdi>{source.path}</bdi>
    </span>
  </div>
)

const MoreButton = ({
  hasMore,
  fetching,
  onMore,
}: {
  hasMore: boolean
  fetching: boolean
  onMore: () => void
}) => {
  const { t } = useTranslation()
  if (!hasMore) return undefined
  return (
    <button
      type="button"
      className="button button--glass button--small adm-more"
      disabled={fetching}
      onClick={onMore}
    >
      {fetching ? <span className="spinner" aria-hidden="true" /> : undefined}
      {t('admin.review.more')}
    </button>
  )
}

// ── Fichiers en attente ──────────────────────────────────────────────────────

/**
 * `/admin/pending` (§7.3, §15 "Fichiers en attente"): the files not ready yet, why (still
 * written, unreadable, damaged, too small), their size, since when they wait and when they last
 * changed; "Check again" probes one again now, "Hide" takes it out of every list (§7.8).
 * Follows the pipeline live.
 */
export const PendingPage = () => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const queryClient = useQueryClient()
  const list = useInfiniteQuery(sourcesByStateQuery('pending'))
  const [hiding, setHiding] = useState<SourceDto>()
  useLiveSources()
  const recheck = useMutation({
    mutationFn: (id: string) =>
      request(() => api.admin.sources[':id'].recheck.$post({ param: { id } })),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: sourcesByStateQueryKey }),
  })
  const sources = list.data?.pages.flatMap((page) => page.items) ?? []
  const total = list.data?.pages[0]?.total ?? 0

  return (
    <div className="admin-page">
      <div className="admin-page__header">
        <div className="admin-page__heading">
          <h1 className="admin-page__title">{t('admin.pending.title')}</h1>
          {total > 0 ? (
            <p className="admin-page__summary">
              {t('admin.review.summary', { count: total, formatted: formatNumber(total, locale) })}
            </p>
          ) : undefined}
        </div>
      </div>

      {recheck.isError ? <ErrorAlert error={recheck.error} /> : undefined}

      <div className="adm-table" role="table" aria-label={t('admin.pending.title')}>
        <div className="adm-tr pending-tr adm-tr--head" role="row">
          <span role="columnheader">{t('admin.pending.columns.file')}</span>
          <span role="columnheader">{t('admin.pending.columns.reason')}</span>
          <span role="columnheader" className="adm-optional">
            {t('admin.pending.columns.size')}
          </span>
          <span role="columnheader" className="adm-optional">
            {t('admin.pending.columns.since')}
          </span>
          <span role="columnheader" className="adm-optional">
            {t('admin.pending.columns.changed')}
          </span>
          <span role="columnheader" />
        </div>
        <div className="adm-table__body">
          {list.isPending ? <SkeletonRows /> : undefined}
          {list.isError && sources.length === 0 ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : undefined}
          {list.isSuccess && sources.length === 0 ? (
            <EmptyState title={t('admin.pending.empty')} />
          ) : undefined}
          {sources.map((source) => {
            const busy = recheck.isPending && recheck.variables === source.id
            return (
              <div key={source.id} className="adm-tr pending-tr" role="row">
                <FileCell source={source} />
                <div className="adm-cell" role="cell">
                  <span>
                    <span className="badge">
                      {t(`admin.pending.reason.${source.pendingReason ?? 'growing'}`)}
                    </span>
                  </span>
                </div>
                <div className="adm-cell adm-optional" role="cell">
                  <span className="adm-mono">{formatBytes(source.sizeBytes, locale)}</span>
                </div>
                <div className="adm-cell adm-optional" role="cell">
                  <Ago iso={source.pendingSince} />
                </div>
                <div className="adm-cell adm-optional" role="cell">
                  <Ago iso={source.unchangedSince} />
                </div>
                <div className="adm-actions" role="cell">
                  <button
                    type="button"
                    className="button button--glass button--small"
                    disabled={busy}
                    aria-label={t('admin.pending.recheckNamed', {
                      name: fileName(source.relativePath),
                    })}
                    onClick={() => recheck.mutate(source.id)}
                  >
                    {busy ? <span className="spinner" aria-hidden="true" /> : undefined}
                    {t('admin.pending.recheck')}
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t('admin.hidden.hideNamed', {
                      name: fileName(source.relativePath),
                    })}
                    onClick={() => setHiding(source)}
                  >
                    <EyeOffIcon />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <MoreButton
        hasMore={list.hasNextPage}
        fetching={list.isFetchingNextPage}
        onMore={() => void list.fetchNextPage()}
      />

      {hiding === undefined ? undefined : (
        <HideSourceDialog key={hiding.id} source={hiding} onClose={() => setHiding(undefined)} />
      )}
    </div>
  )
}

// ── Manquants ────────────────────────────────────────────────────────────────

type Purging = { kind: 'one'; source: SourceDto } | { kind: 'all'; count: number }

const PurgeDialog = ({ purging, onClose }: { purging: Purging; onClose: () => void }) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const queryClient = useQueryClient()
  const purge = useMutation({
    mutationFn: async (): Promise<void> => {
      if (purging.kind === 'one')
        await request(() => api.admin.sources[':id'].$delete({ param: { id: purging.source.id } }))
      else await request(() => api.admin.sources['purge-missing'].$post({ json: {} }))
    },
    onSuccess: async () => {
      onClose()
      await queryClient.invalidateQueries({ queryKey: sourcesByStateQueryKey })
      void queryClient.invalidateQueries({ queryKey: statsQueryKey })
    },
  })
  return (
    <Dialog
      open
      title={
        purging.kind === 'one'
          ? t('admin.missing.purgeTitle', { name: fileName(purging.source.relativePath) })
          : t('admin.missing.purgeAllTitle', {
              count: purging.count,
              formatted: formatNumber(purging.count, locale),
            })
      }
      onClose={() => {
        if (!purge.isPending) onClose()
      }}
      footer={
        <>
          <button type="button" className="button" disabled={purge.isPending} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="button button--danger"
            disabled={purge.isPending}
            onClick={() => purge.mutate()}
          >
            {purge.isPending ? <span className="spinner" aria-hidden="true" /> : undefined}
            {t('admin.missing.purge')}
          </button>
        </>
      }
    >
      <p className="dialog__text">{t('admin.missing.purgeText')}</p>
      {purge.isError ? <ErrorAlert error={purge.error} /> : undefined}
    </Dialog>
  )
}

/**
 * `/admin/missing` (§7.5, §15 "Manquants"): files gone from the disk, since when, the item they
 * belong to; purge one or all (the daily `purge_missing` does it after 30 days).
 */
export const MissingPage = () => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const list = useInfiniteQuery(sourcesByStateQuery('missing'))
  const [purging, setPurging] = useState<Purging | undefined>()
  useLiveSources()
  const sources = list.data?.pages.flatMap((page) => page.items) ?? []
  const total = list.data?.pages[0]?.total ?? 0

  return (
    <div className="admin-page">
      <div className="admin-page__header">
        <div className="admin-page__heading">
          <h1 className="admin-page__title">{t('admin.missing.title')}</h1>
          {total > 0 ? (
            <p className="admin-page__summary">
              {t('admin.review.summary', { count: total, formatted: formatNumber(total, locale) })}
            </p>
          ) : undefined}
        </div>
        <div className="admin-page__actions">
          <button
            type="button"
            className="button button--glass"
            disabled={total === 0}
            onClick={() => setPurging({ kind: 'all', count: total })}
          >
            {t('admin.missing.purgeAll')}
          </button>
        </div>
      </div>

      <div className="adm-table" role="table" aria-label={t('admin.missing.title')}>
        <div className="adm-tr missing-tr adm-tr--head" role="row">
          <span role="columnheader">{t('admin.pending.columns.file')}</span>
          <span role="columnheader">{t('admin.missing.columns.item')}</span>
          <span role="columnheader" className="adm-optional">
            {t('admin.missing.columns.since')}
          </span>
          <span role="columnheader" />
        </div>
        <div className="adm-table__body">
          {list.isPending ? <SkeletonRows /> : undefined}
          {list.isError && sources.length === 0 ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : undefined}
          {list.isSuccess && sources.length === 0 ? (
            <EmptyState title={t('admin.missing.empty')} />
          ) : undefined}
          {sources.map((source) => {
            const item = source.items.map((entry) => itemWithSeriesLabel(t, entry)).join(', ')
            return (
              <div key={source.id} className="adm-tr missing-tr" role="row">
                <FileCell source={source} />
                <div className="adm-cell" role="cell">
                  <span className={item === '' ? 'adm-muted' : 'adm-line'} title={item}>
                    {item === '' ? '—' : item}
                  </span>
                </div>
                <div className="adm-cell adm-optional" role="cell">
                  <Ago iso={source.missingSince} />
                </div>
                <div className="adm-actions" role="cell">
                  <button
                    type="button"
                    className="button button--glass button--small"
                    aria-label={t('admin.missing.purgeNamed', {
                      name: fileName(source.relativePath),
                    })}
                    onClick={() => setPurging({ kind: 'one', source })}
                  >
                    {t('admin.missing.purge')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <MoreButton
        hasMore={list.hasNextPage}
        fetching={list.isFetchingNextPage}
        onMore={() => void list.fetchNextPage()}
      />

      {purging === undefined ? undefined : (
        <PurgeDialog purging={purging} onClose={() => setPurging(undefined)} />
      )}
    </div>
  )
}

// ── Masqués ──────────────────────────────────────────────────────────────────

/**
 * `/admin/hidden` (§7.8, §15 "Masqués"): the files hidden from "To review" or "Fichiers en
 * attente"; "Show again" sends one through the pipeline again (probe, then matching).
 */
export const HiddenPage = () => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const queryClient = useQueryClient()
  const list = useInfiniteQuery(sourcesByStateQuery('rejected'))
  const restore = useMutation({
    mutationFn: (id: string) =>
      request(() => api.admin.sources[':id'].restore.$post({ param: { id } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: sourcesByStateQueryKey })
      void queryClient.invalidateQueries({ queryKey: reviewQueryKey })
      void queryClient.invalidateQueries({ queryKey: statsQueryKey })
    },
  })
  const sources = list.data?.pages.flatMap((page) => page.items) ?? []
  const total = list.data?.pages[0]?.total ?? 0

  return (
    <div className="admin-page">
      <div className="admin-page__header">
        <div className="admin-page__heading">
          <h1 className="admin-page__title">{t('admin.hidden.title')}</h1>
          {total > 0 ? (
            <p className="admin-page__summary">
              {t('admin.review.summary', { count: total, formatted: formatNumber(total, locale) })}
            </p>
          ) : undefined}
        </div>
      </div>

      {restore.isError ? <ErrorAlert error={restore.error} /> : undefined}

      <div className="adm-table" role="table" aria-label={t('admin.hidden.title')}>
        <div className="adm-tr hidden-tr adm-tr--head" role="row">
          <span role="columnheader">{t('admin.pending.columns.file')}</span>
          <span role="columnheader" className="adm-optional">
            {t('admin.pending.columns.size')}
          </span>
          <span role="columnheader" />
        </div>
        <div className="adm-table__body">
          {list.isPending ? <SkeletonRows /> : undefined}
          {list.isError && sources.length === 0 ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : undefined}
          {list.isSuccess && sources.length === 0 ? (
            <EmptyState title={t('admin.hidden.empty')} />
          ) : undefined}
          {sources.map((source) => {
            const busy = restore.isPending && restore.variables === source.id
            return (
              <div key={source.id} className="adm-tr hidden-tr" role="row">
                <FileCell source={source} />
                <div className="adm-cell adm-optional" role="cell">
                  <span className="adm-mono">{formatBytes(source.sizeBytes, locale)}</span>
                </div>
                <div className="adm-actions" role="cell">
                  <button
                    type="button"
                    className="button button--glass button--small"
                    disabled={busy}
                    aria-label={t('admin.hidden.restoreNamed', {
                      name: fileName(source.relativePath),
                    })}
                    onClick={() => restore.mutate(source.id)}
                  >
                    {busy ? <span className="spinner" aria-hidden="true" /> : <EyeIcon size={16} />}
                    {t('admin.hidden.restore')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <MoreButton
        hasMore={list.hasNextPage}
        fetching={list.isFetchingNextPage}
        onMore={() => void list.fetchNextPage()}
      />
    </div>
  )
}
