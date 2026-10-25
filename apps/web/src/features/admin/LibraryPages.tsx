import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ScanRunDto } from '@projo/shared/api/libraries'
import { isErrorCode } from '@projo/shared/errors'

import { formatDateTime, formatNumber } from '../../shared/format/format.ts'
import { currentLocale } from '../../shared/i18n/index.ts'
import { SyncIcon } from '../../shared/ui/icons.tsx'
import { ErrorAlert, ErrorState } from '../../shared/ui/states.tsx'
import { DeleteLibraryDialog } from './DeleteLibraryDialog.tsx'
import { LibraryForm } from './LibraryForm.tsx'
import { useLiveScans } from './live-scans.ts'
import { RefreshLibraryButton } from './metadata/RefreshLibrary.tsx'
import {
  hasAnalysisInProgress,
  isScanning,
  libraryState,
  LibraryStatus,
  useScanLibrary,
} from './library-status.tsx'
import { libraryQuery, scanRunsQuery } from './queries.ts'
import './admin.css'

const Breadcrumb = ({ current }: { current: string }) => {
  const { t } = useTranslation()
  return (
    <nav className="breadcrumb" aria-label={t('admin.breadcrumb')}>
      <Link to="/admin/libraries">{t('admin.libraries.title')}</Link>
      <span aria-hidden="true">/</span>
      <span aria-current="page">{current}</span>
    </nav>
  )
}

/** `/admin/libraries/new`, artboard `AdminAddLibrary`. */
export const NewLibraryPage = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <div className="admin-page">
      <div className="admin-page__heading">
        <Breadcrumb current={t('admin.libraries.new')} />
        <h1 className="admin-page__title">{t('admin.libraries.addTitle')}</h1>
      </div>
      <LibraryForm
        submitLabel={t('admin.form.createAndScan')}
        cancel={
          <Link to="/admin/libraries" className="button">
            {t('common.cancel')}
          </Link>
        }
        onSaved={() => navigate({ to: '/admin/libraries' })}
      />
    </div>
  )
}

const scanKindKey = (kind: ScanRunDto['kind']) => `admin.scanKind.${kind}` as const

const ScanHistory = ({ libraryId }: { libraryId: string }) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const runs = useQuery(scanRunsQuery(libraryId))
  if (runs.isError) return <ErrorAlert error={runs.error} />
  if (runs.isPending) return <div className="skeleton history__skeleton" aria-hidden="true" />
  if (runs.data.items.length === 0) return <p className="hint">{t('admin.history.empty')}</p>
  return (
    <ul className="history">
      {runs.data.items.map((run) => (
        <li key={run.id} className="history__item">
          <span className="history__when">{formatDateTime(run.startedAt, locale)}</span>
          <span className="history__kind">{t(scanKindKey(run.kind))}</span>
          <span className="history__stats">
            {run.finishedAt === undefined
              ? t('admin.status.scanning')
              : run.error !== undefined
                ? isErrorCode(run.error)
                  ? t(`errors.${run.error}`)
                  : run.error
                : t('admin.history.stats', {
                    seen: formatNumber(run.stats.seen, locale),
                    discovered: formatNumber(run.stats.discovered, locale),
                    missing: formatNumber(run.stats.missing, locale),
                  })}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * `/admin/libraries/$libraryId`: edit, scan (quick / full), refresh its metadata (§9.4), scan
 * history, delete (§15).
 */
export const EditLibraryPage = ({ libraryId }: { libraryId: string }) => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const library = useQuery(libraryQuery(libraryId))
  const { scans, markQueued } = useLiveScans({
    analyzing: library.data !== undefined && hasAnalysisInProgress(library.data),
  })
  const scan = useScanLibrary(markQueued)
  const [deleting, setDeleting] = useState(false)

  if (library.isError)
    return (
      <div className="admin-page">
        <ErrorState error={library.error} onRetry={() => void library.refetch()} />
      </div>
    )
  if (library.isPending)
    return (
      <div className="admin-page" aria-busy="true">
        <div className="skeleton skeleton--line admin-page__skeleton-title" />
        <div className="skeleton admin-page__skeleton-block" />
      </div>
    )

  const state = libraryState(library.data, scans.get(libraryId))
  return (
    <div className="admin-page">
      <div className="admin-page__header">
        <div className="admin-page__heading">
          <Breadcrumb current={library.data.name} />
          <h1 className="admin-page__title">{library.data.name}</h1>
          <LibraryStatus state={state} />
        </div>
        <div className="admin-page__actions">
          <button
            type="button"
            className="button button--glass button--small"
            disabled={scan.isPending || isScanning(state)}
            onClick={() => scan.mutate({ id: libraryId, mode: 'quick' })}
          >
            <SyncIcon />
            {t('admin.libraries.quickScan')}
          </button>
          <button
            type="button"
            className="button button--glass button--small"
            disabled={scan.isPending || isScanning(state)}
            onClick={() => scan.mutate({ id: libraryId, mode: 'full' })}
          >
            {t('admin.libraries.fullScan')}
          </button>
          <RefreshLibraryButton libraryId={libraryId} />
        </div>
      </div>
      {scan.isError ? <ErrorAlert error={scan.error} /> : undefined}

      <LibraryForm
        key={library.data.id}
        library={library.data}
        submitLabel={t('common.save')}
        cancel={
          <Link to="/admin/libraries" className="button">
            {t('common.cancel')}
          </Link>
        }
        onSaved={() => navigate({ to: '/admin/libraries' })}
      />

      <section className="admin-section" aria-labelledby="history-title">
        <h2 id="history-title" className="admin-section__title">
          {t('admin.history.title')}
        </h2>
        <ScanHistory libraryId={libraryId} />
      </section>

      <section className="admin-section admin-section--danger" aria-labelledby="danger-title">
        <h2 id="danger-title" className="admin-section__title">
          {t('admin.delete.section')}
        </h2>
        <p className="hint">{t('admin.delete.text')}</p>
        <button
          type="button"
          className="button button--danger button--small"
          onClick={() => setDeleting(true)}
        >
          {t('admin.libraries.delete')}
        </button>
      </section>

      {deleting ? (
        <DeleteLibraryDialog
          library={library.data}
          onClose={() => setDeleting(false)}
          onDeleted={() => navigate({ to: '/admin/libraries', replace: true })}
        />
      ) : undefined}
    </div>
  )
}
