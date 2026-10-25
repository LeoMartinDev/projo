import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  type AdminJobDto,
  type JobStateDto,
  type JobTypeDto,
  jobTypes,
} from '@projo/shared/api/jobs'

import { api, request } from '../../../shared/api/client.ts'
import { formatDateTime, formatRelative, formatSoon } from '../../../shared/format/format.ts'
import { currentLocale } from '../../../shared/i18n/index.ts'
import { Field, SelectChevron } from '../../../shared/ui/controls.tsx'
import { Dialog } from '../../../shared/ui/Dialog.tsx'
import { EmptyState, ErrorAlert, ErrorState } from '../../../shared/ui/states.tsx'
import { useNow } from '../../../shared/ui/use-now.ts'
import { JobsIcon } from '../admin-icons.tsx'
import { jobTargetLabel } from './job-types.ts'
import { jobsQuery, jobsQueryKey, statsQueryKey, useLiveJobs } from './queries.ts'
import { formatContext, useStoredError } from './stored-error.ts'
import '../admin.css'
import '../accounts/accounts.css'
import '../admin-table.css'
import './operations.css'

/** The filters of §15 "Jobs": everything, then running, queued and failed jobs. */
export const jobFilters = ['all', 'running', 'queued', 'failed'] as const
export type JobFilter = (typeof jobFilters)[number]

const stateOf = (filter: JobFilter): JobStateDto | undefined =>
  filter === 'all' ? undefined : filter

/** When a job last moved: finished, started, or when it is due. */
const jobDate = (job: AdminJobDto): string =>
  job.finishedAt ?? (job.state === 'running' ? job.startedAt : undefined) ?? job.runAfter

const pillClass = (state: JobStateDto): string =>
  state === 'failed'
    ? 'acc-pill acc-pill--off'
    : state === 'running'
      ? 'acc-pill job-pill--running'
      : 'acc-pill'

const useJobActions = (onDone?: () => void) => {
  const queryClient = useQueryClient()
  const settle = async () => {
    await queryClient.invalidateQueries({ queryKey: jobsQueryKey })
    void queryClient.invalidateQueries({ queryKey: statsQueryKey })
  }
  const retry = useMutation({
    mutationFn: (id: string) => request(() => api.admin.jobs[':id'].retry.$post({ param: { id } })),
    onSuccess: async () => {
      onDone?.()
      await settle()
    },
  })
  const cancel = useMutation({
    mutationFn: (id: string) =>
      request(() => api.admin.jobs[':id'].cancel.$post({ param: { id } })),
    onSuccess: async () => {
      onDone?.()
      await settle()
    },
  })
  return { retry, cancel }
}

const canRetry = (job: AdminJobDto) => job.state === 'failed' || job.state === 'cancelled'
const canCancel = (job: AdminJobDto) => job.state === 'queued' || job.state === 'running'

const When = ({ iso }: { iso: string }) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const now = useNow()
  const future = new Date(iso).getTime() > now.getTime() + 1000
  return (
    <span className="adm-muted" title={formatDateTime(iso, locale)}>
      {future
        ? t('admin.jobs.due', { date: formatSoon(iso, locale, now) })
        : formatRelative(iso, locale, now)}
    </span>
  )
}

const JobDetails = ({ job, onClose }: { job: AdminJobDto; onClose: () => void }) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const storedError = useStoredError()
  const { retry, cancel } = useJobActions(onClose)
  const pending = retry.isPending || cancel.isPending
  const date = (iso: string | undefined) => (iso === undefined ? '—' : formatDateTime(iso, locale))
  return (
    <Dialog
      open
      title={t(`admin.jobs.type.${job.type}`)}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button" onClick={onClose}>
            {t('common.close')}
          </button>
          {canCancel(job) ? (
            <button
              type="button"
              className="button button--danger"
              disabled={pending}
              onClick={() => cancel.mutate(job.id)}
            >
              {cancel.isPending ? <span className="spinner" aria-hidden="true" /> : undefined}
              {t('admin.jobs.cancel')}
            </button>
          ) : undefined}
          {canRetry(job) ? (
            <button
              type="button"
              className="button button--primary"
              disabled={pending}
              onClick={() => retry.mutate(job.id)}
            >
              {retry.isPending ? <span className="spinner" aria-hidden="true" /> : undefined}
              {t('admin.jobs.retry')}
            </button>
          ) : undefined}
        </>
      }
    >
      <dl className="adm-details">
        <dt>{t('admin.jobs.columns.target')}</dt>
        <dd>{job.target === undefined ? '—' : jobTargetLabel(t, job.target)}</dd>
        <dt>{t('admin.jobs.columns.state')}</dt>
        <dd>
          <span className={pillClass(job.state)}>{t(`admin.jobs.state.${job.state}`)}</span>
        </dd>
        <dt>{t('admin.jobs.columns.attempts')}</dt>
        <dd className="adm-mono">
          {t('admin.jobs.attemptsOf', { attempts: job.attempts, max: job.maxAttempts })}
        </dd>
        <dt>{t('admin.jobs.dueAt')}</dt>
        <dd>{date(job.runAfter)}</dd>
        <dt>{t('admin.jobs.startedAt')}</dt>
        <dd>{date(job.startedAt)}</dd>
        <dt>{t('admin.jobs.finishedAt')}</dt>
        <dd>{date(job.finishedAt)}</dd>
        {job.error === undefined ? undefined : (
          <>
            <dt>{t('admin.jobs.error')}</dt>
            <dd>
              <span className="adm-error">{storedError(job.error)}</span>
              <br />
              <span className="adm-mono adm-muted">{job.error.code}</span>
            </dd>
          </>
        )}
      </dl>
      {job.error?.context === undefined ? undefined : (
        <pre className="adm-context">{formatContext(job.error.context)}</pre>
      )}
      {retry.isError ? <ErrorAlert error={retry.error} /> : undefined}
      {cancel.isError ? <ErrorAlert error={cancel.error} /> : undefined}
    </Dialog>
  )
}

const JobRow = ({
  job,
  busy,
  onOpen,
  onRetry,
  onCancel,
}: {
  job: AdminJobDto
  busy: boolean
  onOpen: () => void
  onRetry: () => void
  onCancel: () => void
}) => {
  const { t } = useTranslation()
  const storedError = useStoredError()
  const typeLabel = t(`admin.jobs.type.${job.type}`)
  return (
    <div className="adm-tr job-tr" role="row">
      <div className="adm-cell" role="cell">
        <button type="button" className="adm-open" aria-haspopup="dialog" onClick={onOpen}>
          {typeLabel}
        </button>
        <span className="adm-muted">
          {job.target === undefined ? '\u00a0' : jobTargetLabel(t, job.target)}
        </span>
      </div>
      <div className="adm-cell job-tr__state" role="cell">
        <span className="job-tr__pills">
          <span className={pillClass(job.state)}>{t(`admin.jobs.state.${job.state}`)}</span>
        </span>
        {job.state === 'running' ? (
          job.progress === undefined ? (
            <span className="bar-live job-tr__bar">
              <progress className="bar" aria-label={typeLabel} />
            </span>
          ) : (
            <progress
              className="bar job-tr__bar"
              value={job.progress}
              max={100}
              aria-label={typeLabel}
            />
          )
        ) : job.error === undefined ? undefined : (
          <span className="adm-muted adm-error" title={storedError(job.error)}>
            {storedError(job.error)}
          </span>
        )}
      </div>
      <div className="adm-cell adm-optional" role="cell">
        <span className="adm-mono">
          {t('admin.jobs.attemptsOf', { attempts: job.attempts, max: job.maxAttempts })}
        </span>
      </div>
      <div className="adm-cell adm-optional" role="cell">
        <When iso={jobDate(job)} />
      </div>
      <div className="adm-actions" role="cell">
        {canRetry(job) ? (
          <button
            type="button"
            className="button button--glass button--small"
            disabled={busy}
            aria-label={t('admin.jobs.retryNamed', { type: typeLabel })}
            onClick={onRetry}
          >
            {t('admin.jobs.retry')}
          </button>
        ) : undefined}
        {canCancel(job) ? (
          <button
            type="button"
            className="button button--small"
            disabled={busy}
            aria-label={t('admin.jobs.cancelNamed', { type: typeLabel })}
            onClick={onCancel}
          >
            {t('admin.jobs.cancel')}
          </button>
        ) : undefined}
      </div>
    </div>
  )
}

const SkeletonRows = () => (
  <>
    {[0, 1, 2, 3].map((index) => (
      <div key={index} className="adm-tr adm-tr--skeleton" aria-hidden="true">
        <span className="skeleton skeleton--line" />
      </div>
    ))}
  </>
)

/**
 * `/admin/jobs` (§15 "Jobs"): queued, running and failed jobs (type, target, state, attempts,
 * error with its code and context in the details), "Relancer", "Undo". Live through
 * `job.updated`. No log viewer (§15).
 */
export const JobsPage = ({
  filter,
  onFilter,
}: {
  filter: JobFilter
  onFilter: (filter: JobFilter) => void
}) => {
  const { t } = useTranslation()
  const typeId = useId()
  const [type, setType] = useState<JobTypeDto | undefined>()
  const [opened, setOpened] = useState<AdminJobDto | undefined>()
  const state = stateOf(filter)
  const list = useInfiniteQuery(
    jobsQuery({
      ...(state === undefined ? {} : { state }),
      ...(type === undefined ? {} : { type }),
    }),
  )
  const { retry, cancel } = useJobActions()
  useLiveJobs()
  const jobs = list.data?.pages.flatMap((page) => page.items) ?? []
  const busyId = retry.isPending ? retry.variables : cancel.isPending ? cancel.variables : undefined
  // The dialog shows the row's latest state (the list refreshes live).
  const current =
    opened === undefined ? undefined : (jobs.find((job) => job.id === opened.id) ?? opened)

  return (
    <div className="admin-page">
      <div className="admin-page__header">
        <h1 className="admin-page__title">{t('admin.jobs.title')}</h1>
      </div>

      <div className="adm-toolbar">
        <div
          className="seg seg--4"
          role="group"
          aria-label={t('admin.jobs.filterLabel')}
          data-active={jobFilters.indexOf(filter)}
        >
          <span className="seg__indicator" aria-hidden="true" />
          {jobFilters.map((value) => (
            <button
              key={value}
              type="button"
              className="seg__option"
              aria-pressed={filter === value}
              onClick={() => onFilter(value)}
            >
              {t(`admin.jobs.filter.${value}`)}
            </button>
          ))}
        </div>
        <Field
          id={typeId}
          label={t('admin.jobs.columns.type')}
          compact
          icon={<JobsIcon size={16} />}
          trail={<SelectChevron />}
        >
          <select
            id={typeId}
            className="field__input"
            value={type ?? ''}
            onChange={(event) =>
              setType(event.target.value === '' ? undefined : (event.target.value as JobTypeDto))
            }
          >
            <option value="">{t('admin.jobs.allTypes')}</option>
            {jobTypes.map((value) => (
              <option key={value} value={value}>
                {t(`admin.jobs.type.${value}`)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {retry.isError ? <ErrorAlert error={retry.error} /> : undefined}
      {cancel.isError ? <ErrorAlert error={cancel.error} /> : undefined}

      <div className="adm-table" role="table" aria-label={t('admin.jobs.title')}>
        <div className="adm-tr job-tr adm-tr--head" role="row">
          <span role="columnheader">{t('admin.jobs.columns.type')}</span>
          <span role="columnheader">{t('admin.jobs.columns.state')}</span>
          <span role="columnheader" className="adm-optional">
            {t('admin.jobs.columns.attempts')}
          </span>
          <span role="columnheader" className="adm-optional">
            {t('admin.jobs.columns.date')}
          </span>
          <span role="columnheader" />
        </div>
        <div className="adm-table__body">
          {list.isPending ? <SkeletonRows /> : undefined}
          {list.isError && jobs.length === 0 ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : undefined}
          {list.isSuccess && jobs.length === 0 ? (
            <EmptyState title={t('admin.jobs.empty')} />
          ) : undefined}
          {jobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              busy={busyId === job.id}
              onOpen={() => setOpened(job)}
              onRetry={() => retry.mutate(job.id)}
              onCancel={() => cancel.mutate(job.id)}
            />
          ))}
        </div>
      </div>

      {list.hasNextPage ? (
        <button
          type="button"
          className="button button--glass button--small adm-more"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {list.isFetchingNextPage ? <span className="spinner" aria-hidden="true" /> : undefined}
          {t('admin.review.more')}
        </button>
      ) : undefined}

      {current === undefined ? undefined : (
        <JobDetails key={current.id} job={current} onClose={() => setOpened(undefined)} />
      )}
    </div>
  )
}
