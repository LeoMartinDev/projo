import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { NotificationDto, NotificationStatus } from '@projo/shared/api/notifications'

import { api, request } from '../../../shared/api/client.ts'
import { formatDateTime, formatRelative } from '../../../shared/format/format.ts'
import { currentLocale } from '../../../shared/i18n/index.ts'
import { Dialog } from '../../../shared/ui/Dialog.tsx'
import { EmptyState, ErrorAlert, ErrorState } from '../../../shared/ui/states.tsx'
import { useNow } from '../../../shared/ui/use-now.ts'
import { notificationDetail, notificationTarget } from './notification-text.ts'
import {
  notificationsQuery,
  notificationsQueryKey,
  statsQueryKey,
  useLiveNotifications,
} from './queries.ts'
import { formatContext } from './stored-error.ts'
import '../admin.css'
import '../accounts/accounts.css'
import '../admin-table.css'
import './operations.css'

const filters = ['all', 'unread', 'read', 'resolved'] as const
type Filter = (typeof filters)[number]

const statusOf = (notification: NotificationDto): NotificationStatus =>
  notification.resolvedAt !== undefined
    ? 'resolved'
    : notification.readAt !== undefined
      ? 'read'
      : 'unread'

const useMarkRead = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) =>
      request(() => api.admin.notifications[':id'].read.$post({ param: { id } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: notificationsQueryKey })
      void queryClient.invalidateQueries({ queryKey: statsQueryKey })
    },
  })
}

/** Opening a notification reads it. */
const NotificationDetails = ({
  notification,
  onClose,
}: {
  notification: NotificationDto
  onClose: () => void
}) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const markRead = useMarkRead()
  const unread = statusOf(notification) === 'unread'
  const { mutate } = markRead
  useEffect(() => {
    if (unread) mutate(notification.id)
  }, [unread, mutate, notification.id])
  const { key: _key, ...context } = notification.context
  const detail = notificationDetail(notification, t, locale)
  return (
    <Dialog
      open
      title={t(`admin.notifications.${notification.kind}`)}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button" onClick={onClose}>
            {t('common.close')}
          </button>
          <Link
            to={notificationTarget(notification.kind)}
            className="button button--primary"
            onClick={onClose}
          >
            {t('admin.notificationCenter.open')}
          </Link>
        </>
      }
    >
      <dl className="adm-details">
        {detail === undefined ? undefined : (
          <>
            <dt>{t('admin.notificationCenter.subject')}</dt>
            <dd>{detail}</dd>
          </>
        )}
        <dt>{t('admin.notificationCenter.createdAt')}</dt>
        <dd>{formatDateTime(notification.createdAt, locale)}</dd>
        <dt>{t('admin.notificationCenter.status')}</dt>
        <dd>
          {notification.resolvedAt === undefined
            ? t(`admin.notificationCenter.state.${statusOf(notification)}`)
            : t('admin.notificationCenter.resolvedAt', {
                date: formatDateTime(notification.resolvedAt, locale),
              })}
        </dd>
      </dl>
      {Object.keys(context).length === 0 ? undefined : (
        <pre className="adm-context">{formatContext(context)}</pre>
      )}
      {markRead.isError ? <ErrorAlert error={markRead.error} /> : undefined}
    </Dialog>
  )
}

const NotificationRow = ({
  notification,
  busy,
  onOpen,
  onRead,
}: {
  notification: NotificationDto
  busy: boolean
  onOpen: () => void
  onRead: () => void
}) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const now = useNow()
  const status = statusOf(notification)
  const title = t(`admin.notifications.${notification.kind}`)
  const detail = notificationDetail(notification, t, locale)
  return (
    <div className="adm-tr notif-tr" role="row" data-status={status}>
      <span
        className="notif-tr__severity"
        role="cell"
        data-severity={notification.severity}
        aria-label={t(`admin.notificationCenter.severity.${notification.severity}`)}
      />
      <div className="adm-cell" role="cell">
        <button type="button" className="adm-open" aria-haspopup="dialog" onClick={onOpen}>
          {title}
        </button>
        <span className="adm-muted adm-path" title={detail}>
          <bdi>{detail ?? '\u00a0'}</bdi>
        </span>
      </div>
      <div className="adm-cell adm-optional" role="cell">
        <span className="adm-muted" title={formatDateTime(notification.createdAt, locale)}>
          {formatRelative(notification.createdAt, locale, now)}
        </span>
      </div>
      <div className="adm-actions" role="cell">
        {status === 'unread' ? (
          <button
            type="button"
            className="button button--glass button--small"
            disabled={busy}
            aria-label={t('admin.notificationCenter.markReadNamed', { title })}
            onClick={onRead}
          >
            {t('admin.notificationCenter.markRead')}
          </button>
        ) : (
          <span className={status === 'resolved' ? 'acc-pill' : 'acc-pill notif-pill--read'}>
            {t(`admin.notificationCenter.state.${status}`)}
          </span>
        )}
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
 * `/admin/notifications` (§15 "Notifications"): the centre, unread first in mind (dot and
 * "Marquer comme lue"), read and resolved ones kept. A row opens its details and reads it; the
 * badge of the menu counts the unread ones. Live through `notification.created`.
 */
export const NotificationsPage = () => {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<Filter>('all')
  const [opened, setOpened] = useState<NotificationDto | undefined>()
  const list = useInfiniteQuery(notificationsQuery(filter === 'all' ? undefined : filter))
  const markRead = useMarkRead()
  useLiveNotifications()
  const items = list.data?.pages.flatMap((page) => page.items) ?? []
  const unread = list.data?.pages[0]?.unreadCount

  return (
    <div className="admin-page">
      <div className="admin-page__header">
        <div className="admin-page__heading">
          <h1 className="admin-page__title">{t('admin.notificationCenter.title')}</h1>
          {unread === undefined || unread === 0 ? undefined : (
            <p className="admin-page__summary">
              {t('admin.notificationCenter.unread', { count: unread })}
            </p>
          )}
        </div>
      </div>

      <div className="adm-toolbar">
        <div
          className="seg seg--4"
          role="group"
          aria-label={t('admin.notificationCenter.filterLabel')}
          data-active={filters.indexOf(filter)}
        >
          <span className="seg__indicator" aria-hidden="true" />
          {filters.map((value) => (
            <button
              key={value}
              type="button"
              className="seg__option"
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {t(`admin.notificationCenter.filter.${value}`)}
            </button>
          ))}
        </div>
      </div>

      {markRead.isError ? <ErrorAlert error={markRead.error} /> : undefined}

      <div className="adm-table" role="table" aria-label={t('admin.notificationCenter.title')}>
        <div className="adm-tr notif-tr adm-tr--head" role="row">
          <span role="columnheader" />
          <span role="columnheader">{t('admin.notificationCenter.columns.notification')}</span>
          <span role="columnheader" className="adm-optional">
            {t('admin.notificationCenter.columns.date')}
          </span>
          <span role="columnheader" />
        </div>
        <div className="adm-table__body">
          {list.isPending ? <SkeletonRows /> : undefined}
          {list.isError && items.length === 0 ? (
            <ErrorState error={list.error} onRetry={() => void list.refetch()} />
          ) : undefined}
          {list.isSuccess && items.length === 0 ? (
            <EmptyState title={t('admin.notificationCenter.empty')} />
          ) : undefined}
          {items.map((notification) => (
            <NotificationRow
              key={notification.id}
              notification={notification}
              busy={markRead.isPending && markRead.variables === notification.id}
              onOpen={() => setOpened(notification)}
              onRead={() => markRead.mutate(notification.id)}
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

      {opened === undefined ? undefined : (
        <NotificationDetails
          key={opened.id}
          notification={opened}
          onClose={() => setOpened(undefined)}
        />
      )}
    </div>
  )
}
