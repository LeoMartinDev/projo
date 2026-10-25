import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { type MouseEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { LibraryDto } from '@projo/shared/api/libraries'
import { isErrorCode } from '@projo/shared/errors'

import { formatNumber, formatRelative } from '../../shared/format/format.ts'
import { currentLocale } from '../../shared/i18n/index.ts'
import {
  FilmIcon,
  LayersIcon,
  MoreIcon,
  PlusIcon,
  SyncIcon,
  TvIcon,
} from '../../shared/ui/icons.tsx'
import { EmptyState, ErrorAlert, ErrorState } from '../../shared/ui/states.tsx'
import { useNow } from '../../shared/ui/use-now.ts'
import { DeleteLibraryDialog } from './DeleteLibraryDialog.tsx'
import { type ActivityEntry, useLiveScans } from './live-scans.ts'
import {
  hasAnalysisInProgress,
  isScanning,
  libraryState,
  LibraryStatus,
  useScanLibrary,
} from './library-status.tsx'
import { librariesQuery } from './queries.ts'
import './admin.css'

const HintIcon = ({ hint }: { hint: LibraryDto['hint'] }) =>
  hint === 'movies' ? <FilmIcon /> : hint === 'series' ? <TvIcon /> : <LayersIcon />

const closePopover = (event: MouseEvent<HTMLElement>) => {
  event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover()
}

const SourceCounts = ({ library }: { library: LibraryDto }) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const { ready, pending, missing } = library.sourceCounts
  return (
    <div className="lib-counts">
      <span className="lib-counts__main">
        {t('admin.counts.ready', { count: ready, formatted: formatNumber(ready, locale) })}
      </span>
      {pending > 0 || missing > 0 ? (
        <span className="lib-counts__detail">
          {[
            pending > 0
              ? t('admin.counts.pending', {
                  count: pending,
                  formatted: formatNumber(pending, locale),
                })
              : undefined,
            missing > 0
              ? t('admin.counts.missing', {
                  count: missing,
                  formatted: formatNumber(missing, locale),
                })
              : undefined,
          ]
            .filter((part) => part !== undefined)
            .join(' · ')}
        </span>
      ) : undefined}
    </div>
  )
}

const ActivityItem = ({
  entry,
  libraries,
}: {
  entry: ActivityEntry
  libraries: readonly LibraryDto[]
}) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const now = useNow()
  const name = libraries.find((library) => library.id === entry.libraryId)?.name ?? '—'
  const text =
    entry.kind === 'sources_ready'
      ? t('admin.activity.ready', { count: entry.count, name })
      : entry.errorCode !== undefined
        ? t('admin.activity.scanFailed', {
            name,
            reason: isErrorCode(entry.errorCode) ? t(`errors.${entry.errorCode}`) : entry.errorCode,
          })
        : t('admin.activity.scanFinished', {
            name,
            discovered: entry.stats.discovered,
            missing: entry.stats.missing,
          })
  return (
    <li className="activity__item">
      <span className="activity__text">{text}</span>
      <time className="activity__time" dateTime={entry.at}>
        {formatRelative(entry.at, locale, now)}
      </time>
    </li>
  )
}

/** Recent activity: what this session saw live, then the last scan of each library. */
const activityFeed = (
  live: readonly ActivityEntry[],
  libraries: readonly LibraryDto[],
): readonly ActivityEntry[] => {
  const seen = new Set(live.map((entry) => entry.id))
  const fromLastScans: ActivityEntry[] = libraries.flatMap((library) => {
    const scan = library.lastScan
    if (scan?.finishedAt === undefined || seen.has(scan.id)) return []
    return [
      {
        id: scan.id,
        kind: 'scan_finished' as const,
        at: scan.finishedAt,
        libraryId: library.id,
        stats: scan.stats,
        ...(scan.error === undefined ? {} : { errorCode: scan.error }),
      },
    ]
  })
  return [...live, ...fromLastScans].toSorted((a, b) => b.at.localeCompare(a.at)).slice(0, 10)
}

const SkeletonRows = () => (
  <>
    {[0, 1, 2].map((index) => (
      <div key={index} className="lib-row lib-row--skeleton" aria-hidden="true">
        <span className="skeleton lib-row__skeleton-icon" />
        <span className="skeleton skeleton--line lib-row__skeleton-text" />
      </div>
    ))}
  </>
)

/** §15 "Librairies", artboard `AdminLibraries`. */
export const LibrariesPage = () => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const now = useNow()
  const libraries = useQuery(librariesQuery)
  const items = libraries.data?.items ?? []
  const { scans, activity, markQueued } = useLiveScans({
    analyzing: items.some(hasAnalysisInProgress),
  })
  const scan = useScanLibrary(markQueued)
  const [deleting, setDeleting] = useState<LibraryDto>()

  const feed = activityFeed(activity, items)
  const totalReady = items.reduce((total, library) => total + library.sourceCounts.ready, 0)

  return (
    <div className="admin-page">
      <div className="admin-page__header">
        <div className="admin-page__heading">
          <h1 className="admin-page__title">{t('admin.libraries.title')}</h1>
          {libraries.isSuccess && items.length > 0 ? (
            <p className="admin-page__summary">
              {t('admin.libraries.summary', {
                count: items.length,
                files: formatNumber(totalReady, locale),
              })}
            </p>
          ) : undefined}
        </div>
        <div className="admin-page__actions">
          {items.length > 0 ? (
            <button
              type="button"
              className="button button--glass button--small"
              disabled={scan.isPending}
              onClick={() => {
                for (const library of items) scan.mutate({ id: library.id, mode: 'quick' })
              }}
            >
              <SyncIcon />
              {t('admin.libraries.syncAll')}
            </button>
          ) : undefined}
          <Link to="/admin/libraries/new" className="button button--primary button--small">
            <PlusIcon />
            {t('admin.libraries.add')}
          </Link>
        </div>
      </div>

      {scan.isError ? <ErrorAlert error={scan.error} /> : undefined}

      {libraries.isError ? (
        <ErrorState error={libraries.error} onRetry={() => void libraries.refetch()} />
      ) : libraries.isSuccess && items.length === 0 ? (
        <EmptyState
          title={t('admin.libraries.emptyTitle')}
          text={t('admin.libraries.emptyText')}
          action={
            <Link to="/admin/libraries/new" className="button button--primary">
              <PlusIcon />
              {t('admin.libraries.add')}
            </Link>
          }
        />
      ) : (
        <div className="lib-table" role="table" aria-label={t('admin.libraries.title')}>
          <div className="lib-row lib-row--head" role="row">
            <span role="columnheader">{t('admin.libraries.columns.name')}</span>
            <span role="columnheader">{t('admin.libraries.columns.content')}</span>
            <span role="columnheader">{t('admin.libraries.columns.lastScan')}</span>
            <span role="columnheader">{t('admin.libraries.columns.state')}</span>
            <span role="columnheader">
              <span className="visually-hidden">{t('admin.libraries.columns.actions')}</span>
            </span>
          </div>
          {libraries.isPending ? <SkeletonRows /> : undefined}
          {items.map((library) => {
            const state = libraryState(library, scans.get(library.id))
            const lastAt = library.lastScan?.finishedAt ?? library.lastScan?.startedAt
            const menuId = `library-menu-${library.id}`
            return (
              <div key={library.id} className="lib-row" role="row">
                <div className="lib-row__name" role="cell">
                  <span className="lib-row__icon" aria-hidden="true">
                    <HintIcon hint={library.hint} />
                  </span>
                  <div className="lib-row__text">
                    <Link
                      to="/admin/libraries/$libraryId"
                      params={{ libraryId: library.id }}
                      className="lib-row__title"
                    >
                      {library.name}
                    </Link>
                    <span className="lib-row__paths mono">
                      <bdi>{library.roots.map((root) => root.path).join(' · ')}</bdi>
                    </span>
                  </div>
                </div>
                <div className="lib-row__cell" role="cell">
                  <span className="lib-row__label" aria-hidden="true">
                    {t('admin.libraries.columns.content')}
                  </span>
                  <SourceCounts library={library} />
                </div>
                <div className="lib-row__cell lib-row__muted" role="cell">
                  <span className="lib-row__label" aria-hidden="true">
                    {t('admin.libraries.columns.lastScan')}
                  </span>
                  {isScanning(state)
                    ? t('admin.libraries.inProgress')
                    : lastAt === undefined
                      ? '—'
                      : formatRelative(lastAt, locale, now)}
                </div>
                <div className="lib-row__cell" role="cell">
                  <LibraryStatus state={state} />
                </div>
                <div className="lib-row__actions" role="cell">
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t('admin.libraries.sync', { name: library.name })}
                    disabled={isScanning(state)}
                    onClick={() => scan.mutate({ id: library.id, mode: 'quick' })}
                  >
                    <SyncIcon />
                  </button>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={t('admin.libraries.more', { name: library.name })}
                    popoverTarget={menuId}
                  >
                    <MoreIcon />
                  </button>
                  <div id={menuId} className="menu menu--row" popover="auto">
                    <button
                      type="button"
                      className="menu__item"
                      onClick={(event) => {
                        closePopover(event)
                        scan.mutate({ id: library.id, mode: 'full' })
                      }}
                    >
                      {t('admin.libraries.fullScan')}
                    </button>
                    <Link
                      to="/admin/libraries/$libraryId"
                      params={{ libraryId: library.id }}
                      className="menu__item"
                    >
                      {t('admin.libraries.edit')}
                    </Link>
                    <button
                      type="button"
                      className="menu__item menu__item--danger"
                      onClick={(event) => {
                        closePopover(event)
                        setDeleting(library)
                      }}
                    >
                      {t('admin.libraries.delete')}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {feed.length > 0 ? (
        <section className="activity" aria-labelledby="activity-title">
          <h2 id="activity-title" className="activity__title">
            {t('admin.activity.title')}
          </h2>
          <ul className="activity__list">
            {feed.map((entry) => (
              <ActivityItem key={entry.id} entry={entry} libraries={items} />
            ))}
          </ul>
        </section>
      ) : undefined}

      {deleting === undefined ? undefined : (
        <DeleteLibraryDialog
          library={deleting}
          onClose={() => setDeleting(undefined)}
          onDeleted={() => setDeleting(undefined)}
        />
      )}
    </div>
  )
}
