import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { AdminSection } from './AdminSection.tsx'
import { sourceCountQuery, unreadNotificationsQuery, useLiveSources } from './operations/queries.ts'
import { reviewCountQuery } from './review/queries.ts'
import { useUpdateSummary } from './updates/queries.ts'

type SectionProps = { actions?: ReactNode; fill?: boolean; children: ReactNode }

/** Media: the libraries, the titles they hold and the live TV sources. */
export const MediaSection = ({ actions, children }: SectionProps) => {
  const { t } = useTranslation()
  return (
    <AdminSection
      title={t('admin.nav.media')}
      tabs={[
        { to: '/admin/libraries', label: t('admin.tabs.libraries') },
        { to: '/admin/catalogue', label: t('admin.tabs.catalogue') },
        { to: '/admin/tv', label: t('admin.tabs.tv') },
      ]}
      {...(actions === undefined ? {} : { actions })}
    >
      {children}
    </AdminSection>
  )
}

/** Files: the state of a file (§7.8), each tab with its count; refreshed as files change. */
export const FilesSection = ({ actions, children }: SectionProps) => {
  const { t } = useTranslation()
  useLiveSources()
  const review = useQuery(reviewCountQuery)
  const pending = useQuery(sourceCountQuery('pending'))
  const missing = useQuery(sourceCountQuery('missing'))
  const hidden = useQuery(sourceCountQuery('rejected'))
  const count = (value: number | undefined) => (value === undefined ? {} : { count: value })
  return (
    <AdminSection
      title={t('admin.nav.files')}
      tabs={[
        { to: '/admin/review', label: t('admin.tabs.review'), ...count(review.data) },
        { to: '/admin/pending', label: t('admin.tabs.pending'), ...count(pending.data) },
        { to: '/admin/missing', label: t('admin.tabs.missing'), ...count(missing.data) },
        { to: '/admin/hidden', label: t('admin.tabs.hidden'), ...count(hidden.data) },
      ]}
      {...(actions === undefined ? {} : { actions })}
    >
      {children}
    </AdminSection>
  )
}

/** Activity: notifications (with the unread count), jobs and logs. */
export const ActivitySection = ({ actions, fill = false, children }: SectionProps) => {
  const { t } = useTranslation()
  const unread = useQuery(unreadNotificationsQuery)
  return (
    <AdminSection
      title={t('admin.nav.activity')}
      fill={fill}
      tabs={[
        {
          to: '/admin/notifications',
          label: t('admin.tabs.notifications'),
          ...(unread.data === undefined ? {} : { count: unread.data }),
        },
        { to: '/admin/jobs', label: t('admin.tabs.jobs') },
        { to: '/admin/logs', label: t('admin.tabs.logs') },
      ]}
      {...(actions === undefined ? {} : { actions })}
    >
      {children}
    </AdminSection>
  )
}

/** Settings: one tab per subject, Updates with a dot while a version is available. */
export const SettingsSection = ({ actions, children }: Omit<SectionProps, 'fill'>) => {
  const { t } = useTranslation()
  const { available } = useUpdateSummary()
  return (
    <AdminSection
      title={t('admin.nav.settings')}
      tabs={[
        { to: '/admin/settings/general', label: t('admin.tabs.general') },
        { to: '/admin/settings/playback', label: t('admin.tabs.playback') },
        { to: '/admin/settings/metadata', label: t('admin.tabs.metadata') },
        { to: '/admin/settings/segments', label: t('admin.tabs.segments') },
        { to: '/admin/settings/assistants', label: t('admin.tabs.assistants') },
        {
          to: '/admin/settings/updates',
          label: t('admin.tabs.updates'),
          ...(available === undefined ? {} : { dot: t('admin.notifications.update/available') }),
        },
      ]}
      {...(actions === undefined ? {} : { actions })}
    >
      {children}
    </AdminSection>
  )
}
