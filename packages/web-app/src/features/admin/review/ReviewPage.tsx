import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ReviewGroupDto, SourceDto } from '@projo/shared/api/libraries'

import { isApiFailure } from '../../../shared/api/failure.ts'
import { formatNumber } from '../../../shared/format/format.ts'
import { useErrorMessage } from '../../../shared/i18n/errors.ts'
import { currentLocale } from '../../../shared/i18n/index.ts'
import {
  ChevronRightIcon,
  EyeOffIcon,
  FilmIcon,
  LayersIcon,
  TvIcon,
} from '../../../shared/ui/icons.tsx'
import { EmptyState, ErrorState } from '../../../shared/ui/states.tsx'
import { SearchIcon } from '../admin-icons.tsx'
import { AdminPageHeader } from '../AdminPageHeader.tsx'
import { SkeletonRows } from '../SkeletonRows.tsx'
import { HideGroupDialog } from './HideGroupDialog.tsx'
import { HideSourceDialog } from './HideSourceDialog.tsx'
import { IdentifySourceDialog } from './IdentifySourceDialog.tsx'
import { fileName, parsedSummary, reviewReason } from './parsed.ts'
import { reviewGroupFilesQuery, reviewGroupsQuery } from './queries.ts'
import {
  groupKey,
  groupLabel,
  isSeriesGroup,
  loadingRows,
  reasonsSummary,
  showFolderPath,
} from './review-groups.ts'
import '../admin.css'
import '../admin-table.css'
import './review.css'

type Acting =
  | { kind: 'identify'; source: SourceDto; series: boolean }
  | { kind: 'hide'; source: SourceDto }
  | { kind: 'hide-group'; group: ReviewGroupDto }

type Act = (acting: Acting) => void

const ClassificationIcon = ({ value }: { value: SourceDto['classification'] }) =>
  value === 'movie' ? <FilmIcon /> : value === 'episode' ? <TvIcon /> : <LayersIcon />

const RowActions = ({
  name,
  onIdentify,
  onHide,
}: {
  name: string
  onIdentify: () => void
  onHide: () => void
}) => {
  const { t } = useTranslation()
  return (
    <div className="adm-actions review-tr__actions" role="cell">
      <button type="button" className="button button--glass button--small" onClick={onIdentify}>
        <SearchIcon size={16} />
        {t('admin.review.identify')}
      </button>
      <button
        type="button"
        className="button button--glass button--small"
        aria-label={t('admin.hidden.hideNamed', { name })}
        onClick={onHide}
      >
        <EyeOffIcon size={16} />
        {t('admin.hidden.hide')}
      </button>
    </div>
  )
}

/** A file to review: a group of one file, or a file of an unfolded group (`nested`). */
const FileRow = ({
  source,
  nested = false,
  act,
}: {
  source: SourceDto
  nested?: boolean
  act: Act
}) => {
  const { t } = useTranslation()
  const reason = reviewReason(source.reviewReason)
  const name = fileName(source.relativePath)
  return (
    <div className={`adm-tr review-tr${nested ? ' review-tr--nested' : ''}`} role="row">
      <div className="review-tr__lead" role="cell">
        {nested ? undefined : (
          <span className="lib-row__icon" aria-hidden="true">
            <ClassificationIcon value={source.classification} />
          </span>
        )}
      </div>
      <div className="adm-cell review-tr__file" role="cell">
        <span className="adm-strong" title={source.relativePath}>
          {name}
        </span>
        <span className="adm-muted adm-path adm-mono" title={source.path}>
          <bdi>{source.path}</bdi>
        </span>
      </div>
      <div className="adm-cell review-tr__parsed" role="cell">
        <span className="review-tr__kind">
          {t(`admin.review.classification.${source.classification}`)}
        </span>
        <span className="review-tr__summary">{parsedSummary(t, source)}</span>
      </div>
      <div className="review-tr__reason" role="cell">
        <span className="badge">
          {reason === undefined ? (source.reviewReason ?? '—') : t(`admin.review.reason.${reason}`)}
        </span>
      </div>
      <RowActions
        name={name}
        onIdentify={() => act({ kind: 'identify', source, series: false })}
        onHide={() => act({ kind: 'hide', source })}
      />
    </div>
  )
}

/** The reasons of a group: the most frequent one, then how many others (all of them on hover). */
const GroupReasons = ({ group }: { group: ReviewGroupDto }) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const { main, others, detail } = reasonsSummary(t, locale, group.reasons)
  return (
    <div className="review-tr__reason" role="cell">
      <span className="visually-hidden">{detail}</span>
      <span className="review-reasons" aria-hidden="true">
        {main === undefined ? undefined : <span className="badge">{main}</span>}
        {others > 0 ? (
          <span className="badge review-reasons__more" title={detail}>
            +{formatNumber(others, locale)}
          </span>
        ) : undefined}
      </span>
    </div>
  )
}

/** The files of an unfolded group, as rows of the table below it. */
const GroupFiles = ({ group, act }: { group: ReviewGroupDto; act: Act }) => {
  const { t } = useTranslation()
  const message = useErrorMessage()
  const queryClient = useQueryClient()
  const files = useQuery(reviewGroupFilesQuery(group.id))
  // Its first file left "To review" meanwhile: the list's refresh replaces or drops this group.
  const gone =
    files.isError && isApiFailure(files.error) && files.error.code === 'source/not_to_review'
  useEffect(() => {
    if (gone) void queryClient.invalidateQueries({ queryKey: reviewGroupsQuery.queryKey })
  }, [gone, queryClient])
  if (files.isPending || gone)
    return (
      <>
        {Array.from({ length: loadingRows(group.count) }, (_, index) => (
          <div key={index} className="adm-tr adm-tr--skeleton review-tr--nested" aria-hidden="true">
            <span className="skeleton skeleton--line" />
          </div>
        ))}
      </>
    )
  if (files.isError)
    return (
      <div className="adm-tr review-tr--nested review-err" role="row">
        <div role="cell" />
        <div className="review-err__message" role="cell">
          <span className="adm-error" role="alert">
            {message(files.error)}
          </span>
          <button
            type="button"
            className="button button--glass button--small"
            disabled={files.isFetching}
            onClick={() => void files.refetch()}
          >
            {t('common.retry')}
          </button>
        </div>
      </div>
    )
  return (
    <>
      {files.data.map((source) => (
        <FileRow key={source.id} source={source} nested act={act} />
      ))}
    </>
  )
}

/** A series group of several files: "<show> · N files", unfolding to its files. */
const GroupRow = ({
  group,
  expanded,
  onToggle,
  act,
}: {
  group: ReviewGroupDto
  expanded: boolean
  onToggle: () => void
  act: Act
}) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const labelId = useId()
  const label = groupLabel(t, locale, group)
  const folder = showFolderPath(group)
  return (
    <>
      <div className="adm-tr review-tr review-tr--group" role="row">
        <div className="review-tr__lead" role="cell">
          <button
            type="button"
            className="review-toggle"
            aria-expanded={expanded}
            aria-labelledby={labelId}
            onClick={onToggle}
          >
            <ChevronRightIcon />
          </button>
        </div>
        <div className="adm-cell review-tr__file" role="cell">
          <span id={labelId} className="adm-strong" title={label}>
            {label}
          </span>
          {folder === undefined ? undefined : (
            <span className="adm-muted adm-path adm-mono" title={folder}>
              <bdi>{folder}</bdi>
            </span>
          )}
        </div>
        <div className="adm-cell review-tr__parsed" role="cell" />
        <GroupReasons group={group} />
        <RowActions
          name={group.series ?? label}
          onIdentify={() => act({ kind: 'identify', source: group.first, series: true })}
          onHide={() => act({ kind: 'hide-group', group })}
        />
      </div>
      {expanded ? <GroupFiles group={group} act={act} /> : undefined}
    </>
  )
}

export const ReviewPage = () => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const queue = useInfiniteQuery(reviewGroupsQuery)
  const groups = queue.data?.pages.flatMap((page) => page.items) ?? []
  const total = queue.data?.pages[0]?.total ?? 0
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [acting, setActing] = useState<Acting>()
  const close = () => setActing(undefined)

  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })

  return (
    <div className="admin-page">
      <AdminPageHeader
        title={t('admin.review.title')}
        summary={
          queue.isSuccess && groups.length > 0
            ? t('admin.review.summary', { count: total, formatted: formatNumber(total, locale) })
            : undefined
        }
      />

      <div className="adm-table review-table" role="table" aria-label={t('admin.review.title')}>
        <div className="adm-tr review-tr adm-tr--head" role="row">
          <span role="columnheader" />
          <span role="columnheader">{t('admin.review.columns.file')}</span>
          <span role="columnheader">{t('admin.review.columns.parsed')}</span>
          <span role="columnheader">{t('admin.review.columns.reason')}</span>
          <span role="columnheader" />
        </div>
        <div className="adm-table__body">
          {queue.isPending ? <SkeletonRows count={4} /> : undefined}
          {queue.isError && groups.length === 0 ? (
            <ErrorState error={queue.error} onRetry={() => void queue.refetch()} />
          ) : undefined}
          {queue.isSuccess && groups.length === 0 ? (
            <EmptyState title={t('admin.review.empty')} />
          ) : undefined}
          {groups.map((group) => {
            if (!isSeriesGroup(group))
              return <FileRow key={group.id} source={group.first} act={setActing} />
            const key = groupKey(group)
            return (
              <GroupRow
                key={key}
                group={group}
                expanded={expanded.has(key)}
                onToggle={() => toggle(key)}
                act={setActing}
              />
            )
          })}
        </div>
      </div>

      {queue.hasNextPage ? (
        <button
          type="button"
          className="button button--glass button--small adm-more"
          disabled={queue.isFetchingNextPage}
          onClick={() => void queue.fetchNextPage()}
        >
          {queue.isFetchingNextPage ? <span className="spinner" aria-hidden="true" /> : undefined}
          {t('admin.review.more')}
        </button>
      ) : undefined}

      {acting?.kind === 'identify' ? (
        <IdentifySourceDialog
          key={acting.source.id}
          source={acting.source}
          series={acting.series}
          onClose={close}
        />
      ) : undefined}
      {acting?.kind === 'hide' ? (
        <HideSourceDialog key={acting.source.id} source={acting.source} onClose={close} />
      ) : undefined}
      {acting?.kind === 'hide-group' ? (
        <HideGroupDialog key={acting.group.id} group={acting.group} onClose={close} />
      ) : undefined}
    </div>
  )
}
