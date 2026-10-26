import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { episodeLine, itemTitle } from '@projo/i18n/item-titles'
import { versionLabel } from '@projo/i18n/versions'
import type { AdminPlaybackSessionDto } from '@projo/shared/api/playback'
import type { AvatarColor } from '@projo/shared/api/profiles'

import { api, request } from '../../../shared/api/client.ts'
import { formatClock } from '../../../shared/format/format.ts'
import { EmptyState, ErrorAlert, ErrorState } from '../../../shared/ui/states.tsx'
import { AdminAvatar, avatarColors } from '../accounts/parts.tsx'
import { playbackSessionsQuery, playbackSessionsQueryKey } from './queries.ts'
import '../admin.css'
import '../accounts/accounts.css'
import './sessions.css'

const colorOf = (color: string): AvatarColor | 'neutral' =>
  (avatarColors as readonly string[]).includes(color) ? (color as AvatarColor) : 'neutral'

const SkeletonRows = () => (
  <>
    {[0, 1].map((index) => (
      <div key={index} className="ses-tr ses-tr--skeleton" aria-hidden="true">
        <span className="skeleton ses-tr__skeleton-avatar" />
        <span className="skeleton skeleton--line ses-tr__skeleton-text" />
      </div>
    ))}
  </>
)

const SessionRow = ({
  session,
  stopping,
  onStop,
}: {
  session: AdminPlaybackSessionDto
  stopping: boolean
  onStop: () => void
}) => {
  const { t } = useTranslation()
  const { item } = session
  const ratio =
    session.durationMs === undefined || session.durationMs <= 0
      ? undefined
      : Math.min(1, session.positionMs / session.durationMs)
  const position =
    session.durationMs === undefined
      ? formatClock(session.positionMs)
      : t('admin.sessions.positionOf', {
          position: formatClock(session.positionMs),
          duration: formatClock(session.durationMs),
        })
  const version = versionLabel(t, session.version)
  return (
    <div className="ses-tr" role="row">
      <div className="ses-tr__who" role="cell">
        <AdminAvatar name={session.profile.name} color={colorOf(session.profile.color)} />
        <span className="ses-tr__lines">
          <span className="ses-tr__strong">{session.profile.name}</span>
          <span className="ses-tr__muted">{session.account.name}</span>
        </span>
      </div>
      <div className="ses-tr__cell" role="cell">
        <span className="ses-tr__lines">
          <span className="ses-tr__strong">{item.seriesTitle ?? itemTitle(t, item)}</span>
          {item.kind === 'episode' ? (
            <span className="ses-tr__muted">{episodeLine(t, item)}</span>
          ) : undefined}
        </span>
      </div>
      <div className="ses-tr__cell ses-tr__playback" role="cell">
        <span className="ses-pills">
          <span className="acc-pill" data-mode={session.mode}>
            {t(`admin.sessions.mode.${session.mode}`)}
          </span>
          <span className="acc-pill">
            {session.quality === 'original' ? t('admin.sessions.original') : session.quality}
          </span>
          {session.burnIn ? (
            <span className="acc-pill">{t('admin.sessions.burnIn')}</span>
          ) : undefined}
        </span>
        {version === undefined ? undefined : (
          <span className="ses-tr__muted ses-tr__mono">{version}</span>
        )}
      </div>
      <div className="ses-tr__cell ses-tr__position" role="cell">
        <span className="ses-tr__mono">{position}</span>
        {ratio === undefined ? undefined : (
          <progress className="bar ses-tr__bar" value={ratio} max={1} aria-label={position} />
        )}
      </div>
      <div className="ses-tr__cell ses-tr__device" role="cell">
        <span className="ses-tr__muted">{session.device ?? '—'}</span>
      </div>
      <div className="ses-tr__action" role="cell">
        <button
          type="button"
          className="button button--glass button--small"
          disabled={stopping}
          aria-label={t('admin.sessions.stopNamed', {
            profile: session.profile.name,
            title: item.seriesTitle ?? itemTitle(t, item),
          })}
          onClick={onStop}
        >
          {stopping ? <span className="spinner" aria-hidden="true" /> : undefined}
          {t('admin.sessions.stop')}
        </button>
      </div>
    </div>
  )
}

/**
 * `/admin/sessions` (§10.6, §15 "Active sessions"): who watches what, how (mode, quality, burnt-in
 * subtitles, version), where in it and from which device; "Stop" ends a session (the player
 * shows "Playback stopped by the administrator"). Polled every 5 s.
 */
export const SessionsPage = () => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const sessions = useQuery(playbackSessionsQuery)
  const stop = useMutation({
    mutationFn: (id: string) =>
      request(() => api.admin.playback.sessions[':id'].$delete({ param: { id } })),
    onSettled: () => queryClient.invalidateQueries({ queryKey: playbackSessionsQueryKey }),
  })
  const items = sessions.data ?? []

  return (
    <div className="admin-page ses-page">
      <div className="admin-page__header">
        <div className="admin-page__heading">
          <h1 className="admin-page__title">{t('admin.sessions.title')}</h1>
          {sessions.isSuccess && items.length > 0 ? (
            <p className="admin-page__summary">
              {t('admin.sessions.summary', { count: items.length })}
            </p>
          ) : undefined}
        </div>
      </div>

      {stop.isError ? <ErrorAlert error={stop.error} /> : undefined}

      <div className="ses-table" role="table" aria-label={t('admin.sessions.list')}>
        <div className="ses-tr ses-tr--head" role="row">
          <span role="columnheader">{t('admin.sessions.columns.profile')}</span>
          <span role="columnheader">{t('admin.sessions.columns.title')}</span>
          <span role="columnheader">{t('admin.sessions.columns.playback')}</span>
          <span role="columnheader">{t('admin.sessions.columns.position')}</span>
          <span role="columnheader" className="ses-tr__device">
            {t('admin.sessions.columns.device')}
          </span>
          <span role="columnheader" />
        </div>
        <div className="ses-table__body">
          {sessions.isPending ? <SkeletonRows /> : undefined}
          {sessions.isSuccess && items.length === 0 ? (
            <EmptyState title={t('admin.sessions.empty')} />
          ) : undefined}
          {sessions.isError ? (
            <ErrorState error={sessions.error} onRetry={() => void sessions.refetch()} />
          ) : (
            items.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                stopping={stop.isPending && stop.variables === session.id}
                onStop={() => stop.mutate(session.id)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
