import { Link, type LinkProps, useCanGoBack, useRouter } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { ChevronLeftIcon } from './media-icons.tsx'

/** A link to `to` that goes back in history instead when the app was navigated to this page. */
export const BackLink = ({
  to = '/',
  className,
  label,
  children,
}: {
  to?: LinkProps['to']
  className: string
  label?: string
  children: ReactNode
}) => {
  const router = useRouter()
  const canGoBack = useCanGoBack()
  return (
    <Link
      to={to}
      className={className}
      {...(label === undefined ? {} : { 'aria-label': label })}
      onClick={(event) => {
        if (!canGoBack) return
        event.preventDefault()
        router.history.back()
      }}
    >
      {children}
    </Link>
  )
}

/** The round back button before a page title (a `BackLink` drawn as a chevron). */
export const BackButton = ({
  to,
  className = 'page__back',
}: {
  to?: LinkProps['to']
  className?: string
}) => {
  const { t } = useTranslation()
  return (
    <BackLink {...(to === undefined ? {} : { to })} className={className} label={t('common.back')}>
      <ChevronLeftIcon size={18} />
    </BackLink>
  )
}
