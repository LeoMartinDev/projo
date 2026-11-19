import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { type MouseEvent, useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ScanRunDto } from '@projo/shared/api/libraries'
import { isErrorCode } from '@projo/shared/errors'

import { formatDateTime, formatNumber } from '../../shared/format/format.ts'
import { currentLocale } from '../../shared/i18n/index.ts'
import { Dialog } from '../../shared/ui/Dialog.tsx'
import { CheckIcon, MoreIcon } from '../../shared/ui/icons.tsx'
import { EmptyState, ErrorAlert, ErrorState } from '../../shared/ui/states.tsx'
import { DeleteLibraryDialog } from './DeleteLibraryDialog.tsx'
import { DialogTabPanel, DialogTabs } from './DialogTabs.tsx'
import { LibraryForm, type LibraryFormStatus } from './LibraryForm.tsx'
import type { LiveScan } from './live-scans.ts'
import { isScanning, libraryState, LibraryStatus, type useScanLibrary } from './library-status.tsx'
import { useRefreshLibrary } from './metadata/queries.ts'
import { Pager } from './PagedTable.tsx'
import { libraryQuery, scanRunsPageSize, scanRunsQuery } from './queries.ts'
import { useCursorPages } from './use-cursor-pages.ts'
import './admin.css'
import './admin-table.css'

type ScanLibrary = ReturnType<typeof useScanLibrary>
type Tab = 'settings' | 'history'

const idle: LibraryFormStatus = { dirty: false, pending: false }
const queuedMs = 4000
/** The history shows the last 20 scans (§15). */
const historyLength = 20

const closePopover = (event: MouseEvent<HTMLElement>) => {
  event.currentTarget.closest<HTMLElement>('[popover]')?.hidePopover()
}

const scanKindKey = (kind: ScanRunDto['kind']) => `admin.scanKind.${kind}` as const

const ScanHistory = ({ libraryId }: { libraryId: string }) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const pages = useCursorPages(libraryId)
  const runs = useQuery({
    ...scanRunsQuery(libraryId, pages.cursor),
    placeholderData: keepPreviousData,
  })
  if (runs.isError) return <ErrorState error={runs.error} onRetry={() => void runs.refetch()} />
  if (runs.isPending) return <div className="skeleton history__skeleton" aria-hidden="true" />
  if (runs.data.items.length === 0) return <EmptyState compact title={t('admin.history.empty')} />
  const nextCursor =
    pages.page * scanRunsPageSize < historyLength ? runs.data.nextCursor : undefined
  return (
    <>
      <ul className="history" aria-label={t('admin.history.title')}>
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
      {pages.page > 1 || nextCursor !== undefined ? (
        <Pager pages={pages} nextCursor={nextCursor} changing={runs.isPlaceholderData} />
      ) : undefined}
    </>
  )
}

/** "Refresh queued" for a few seconds once the metadata refresh is accepted. */
const useQueuedNotice = (job: { isSuccess: boolean; reset: () => void }) => {
  const { isSuccess, reset } = job
  useEffect(() => {
    if (!isSuccess) return
    const timer = setTimeout(reset, queuedMs)
    return () => clearTimeout(timer)
  }, [isSuccess, reset])
  return isSuccess
}

/**
 * A library's details (§15): its state under its name, its actions in a menu, its settings and
 * its scan history in tabs. Saving closes it; so does deleting the library.
 */
export const LibraryDialog = ({
  libraryId,
  live,
  scan,
  onClose,
}: {
  libraryId: string
  live: LiveScan | undefined
  scan: ScanLibrary
  onClose: () => void
}) => {
  const { t } = useTranslation()
  const ids = useId()
  const formId = `${ids}-form`
  const menuId = `${ids}-menu`
  const library = useQuery(libraryQuery(libraryId))
  const refresh = useRefreshLibrary()
  const refreshQueued = useQueuedNotice(refresh)
  const [tab, setTab] = useState<Tab>('settings')
  const [status, setStatus] = useState<LibraryFormStatus>(idle)
  const [deleting, setDeleting] = useState(false)

  const data = library.data
  const state = data === undefined ? undefined : libraryState(data, live)
  const scanning = scan.isPending || (state !== undefined && isScanning(state))
  const error = scan.isError ? scan.error : refresh.isError ? refresh.error : undefined

  const menu =
    data === undefined ? undefined : (
      <>
        <button
          type="button"
          className="icon-button"
          aria-label={t('admin.libraries.more', { name: data.name })}
          popoverTarget={menuId}
        >
          <MoreIcon />
        </button>
        <div id={menuId} className="menu menu--row" popover="auto">
          <button
            type="button"
            className="menu__item"
            disabled={scanning}
            onClick={(event) => {
              closePopover(event)
              scan.mutate({ id: libraryId, mode: 'quick' })
            }}
          >
            {t('admin.libraries.quickScan')}
          </button>
          <button
            type="button"
            className="menu__item"
            disabled={scanning}
            onClick={(event) => {
              closePopover(event)
              scan.mutate({ id: libraryId, mode: 'full' })
            }}
          >
            {t('admin.libraries.fullScan')}
          </button>
          <button
            type="button"
            className="menu__item"
            disabled={refresh.isPending || refreshQueued}
            onClick={(event) => {
              closePopover(event)
              refresh.mutate(libraryId)
            }}
          >
            {t('admin.metadataRefresh.action')}
          </button>
          <button
            type="button"
            className="menu__item menu__item--danger"
            onClick={(event) => {
              closePopover(event)
              setDeleting(true)
            }}
          >
            {t('admin.libraries.delete')}
          </button>
        </div>
      </>
    )

  return (
    <>
      <Dialog
        open
        large
        title={data?.name ?? t('common.loading')}
        subtitle={
          state === undefined ? undefined : (
            <>
              <LibraryStatus state={state} />
              {refreshQueued ? (
                <span className="lib-dialog__notice" role="status">
                  <CheckIcon size={14} />
                  {t('admin.metadataRefresh.queued')}
                </span>
              ) : undefined}
            </>
          )
        }
        {...(menu === undefined ? {} : { actions: menu })}
        tabs={
          <DialogTabs
            idPrefix={ids}
            label={data?.name ?? t('admin.libraries.title')}
            tabs={[
              { value: 'settings', label: t('admin.libraries.tabs.settings') },
              { value: 'history', label: t('admin.libraries.tabs.history') },
            ]}
            value={tab}
            onChange={setTab}
          />
        }
        onClose={onClose}
        footer={
          tab === 'settings' ? (
            <>
              <button type="button" className="button" onClick={onClose}>
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                form={formId}
                className="button button--primary"
                disabled={!status.dirty || status.pending}
              >
                {status.pending ? <span className="spinner" aria-hidden="true" /> : undefined}
                {t('common.save')}
              </button>
            </>
          ) : (
            <button type="button" className="button" onClick={onClose}>
              {t('common.close')}
            </button>
          )
        }
      >
        {error === undefined ? undefined : <ErrorAlert error={error} />}
        {library.isError ? (
          <ErrorState error={library.error} onRetry={() => void library.refetch()} />
        ) : data === undefined ? (
          <div className="skeleton lib-dialog__skeleton" aria-hidden="true" />
        ) : (
          <>
            <DialogTabPanel idPrefix={ids} value="settings" current={tab}>
              <LibraryForm
                id={formId}
                library={data}
                onStatusChange={setStatus}
                onSaved={onClose}
              />
            </DialogTabPanel>
            <DialogTabPanel idPrefix={ids} value="history" current={tab}>
              <ScanHistory libraryId={libraryId} />
            </DialogTabPanel>
          </>
        )}
      </Dialog>

      {deleting && data !== undefined ? (
        <DeleteLibraryDialog
          library={data}
          onClose={() => setDeleting(false)}
          onDeleted={onClose}
        />
      ) : undefined}
    </>
  )
}

/** A new library: the same dialog, its settings only; creating it starts its first scan. */
export const NewLibraryDialog = ({ onClose }: { onClose: () => void }) => {
  const { t } = useTranslation()
  const formId = `${useId()}-form`
  const [status, setStatus] = useState<LibraryFormStatus>(idle)
  return (
    <Dialog
      open
      large
      title={t('admin.libraries.addTitle')}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button
            type="submit"
            form={formId}
            className="button button--primary"
            disabled={status.pending}
          >
            {status.pending ? <span className="spinner" aria-hidden="true" /> : undefined}
            {t('admin.form.createAndScan')}
          </button>
        </>
      }
    >
      <LibraryForm id={formId} onStatusChange={setStatus} onSaved={onClose} />
    </Dialog>
  )
}
