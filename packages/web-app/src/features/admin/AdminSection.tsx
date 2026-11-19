import { Link, useRouterState } from '@tanstack/react-router'
import { type ReactNode, useEffect } from 'react'

import { formatNumber } from '../../shared/format/format.ts'
import { currentLocale } from '../../shared/i18n/index.ts'
import { useElement } from '../../shared/ui/use-element.ts'
import './admin.css'

/** A tab of a section: a route of its own. */
export type AdminTab = {
  to:
    | '/admin/libraries'
    | '/admin/tv'
    | '/admin/review'
    | '/admin/pending'
    | '/admin/missing'
    | '/admin/hidden'
    | '/admin/notifications'
    | '/admin/jobs'
    | '/admin/logs'
    | '/admin/settings/general'
    | '/admin/settings/playback'
    | '/admin/settings/metadata'
    | '/admin/settings/segments'
    | '/admin/settings/assistants'
    | '/admin/settings/updates'
  label: string
  /** Shown beside the label when above zero. */
  count?: number
  /** A dot beside the label, with this accessible name (an update available). */
  dot?: string
}

const TabCount = ({ count }: { count: number | undefined }) => {
  const locale = currentLocale()
  if (count === undefined || count === 0) return undefined
  return <span className="admin-tabs__count">{formatNumber(count, locale)}</span>
}

/** The bar of a section's tabs; on a narrow screen it scrolls, the current tab kept in view. */
const Tabs = ({ label, tabs }: { label: string; tabs: readonly AdminTab[] }) => {
  const [nav, navRef] = useElement<HTMLElement>()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  useEffect(() => {
    nav
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [nav, pathname])
  return (
    <nav ref={navRef} className="admin-tabs" aria-label={label}>
      {tabs.map((tab) => (
        <Link key={tab.to} to={tab.to} className="admin-tabs__tab">
          <span className="admin-tabs__label">{tab.label}</span>
          <TabCount count={tab.count} />
          {tab.dot === undefined ? undefined : (
            <span className="admin__dot" role="img" aria-label={tab.dot} />
          )}
        </Link>
      ))}
    </nav>
  )
}

/**
 * A section of the admin (§15): its name, its actions on the right (the header keeps its height
 * with or without them), the bar of its tabs, then the current tab. `fill`: the tab fills the
 * window's height (logs, jobs).
 */
export const AdminSection = ({
  title,
  tabs,
  actions,
  fill = false,
  children,
}: {
  title: string
  tabs?: readonly AdminTab[]
  actions?: ReactNode
  fill?: boolean
  children: ReactNode
}) => (
  <div className={fill ? 'admin-page admin-page--fill' : 'admin-page'}>
    <div className="admin-head">
      <div className="admin-head__top">
        <h1 className="admin-page__title">{title}</h1>
        {actions === undefined ? undefined : <div className="admin-page__actions">{actions}</div>}
      </div>
      {tabs === undefined ? undefined : <Tabs label={title} tabs={tabs} />}
    </div>
    {children}
  </div>
)
