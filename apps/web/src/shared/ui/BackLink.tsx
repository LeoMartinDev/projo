import { Link, type LinkProps, useCanGoBack, useRouter } from '@tanstack/react-router'
import type { ReactNode } from 'react'

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
