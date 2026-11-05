import type { LinkProps } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { BackLink } from '../../shared/ui/BackLink.tsx'
import { ChevronLeftIcon } from '../../shared/ui/media-icons.tsx'

/** Title of an admin sub-page: a back button (history back, `back` when opened directly) then the h1. */
export const AdminPageTitle = ({
  back,
  children,
}: {
  back: LinkProps['to']
  children: ReactNode
}) => {
  const { t } = useTranslation()
  return (
    <div className="admin-page__title-row">
      <BackLink to={back} className="admin-back" label={t('common.back')}>
        <ChevronLeftIcon size={18} />
      </BackLink>
      <h1 className="admin-page__title">{children}</h1>
    </div>
  )
}
