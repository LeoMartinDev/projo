import type { LinkProps } from '@tanstack/react-router'
import type { ReactNode } from 'react'

import { BackButton } from '../../shared/ui/BackLink.tsx'

/**
 * Header of an admin page: the h1 (after a back button on a sub-page: history back, `back` when
 * opened directly), a summary under it, actions on the right. A string summary is drawn muted; any
 * other node (status, badges) as it is.
 */
export const AdminPageHeader = ({
  title,
  back,
  summary,
  actions,
}: {
  title: string
  back?: LinkProps['to']
  summary?: ReactNode
  actions?: ReactNode
}) => {
  const heading = <h1 className="admin-page__title">{title}</h1>
  return (
    <div className="admin-page__header">
      <div className="admin-page__heading">
        {back === undefined ? (
          heading
        ) : (
          <div className="admin-page__title-row">
            <BackButton to={back} className="admin-back" />
            {heading}
          </div>
        )}
        {typeof summary === 'string' ? <p className="admin-page__summary">{summary}</p> : summary}
      </div>
      {actions === undefined ? undefined : <div className="admin-page__actions">{actions}</div>}
    </div>
  )
}
