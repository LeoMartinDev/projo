import type { ReactNode } from 'react'

import { BackButton } from './BackLink.tsx'
import './settings.css'

/** A narrow settings page: back button, an optional visual (an avatar), the title, then panels. */
export const SettingsPage = ({
  title,
  subtitle,
  leading,
  children,
}: {
  title: string
  subtitle?: string
  leading?: ReactNode
  children: ReactNode
}) => (
  <div className="page page--narrow settings">
    <div className="settings__head">
      <BackButton />
      {leading}
      <div className="settings__who">
        <h1 className="page__title">{title}</h1>
        {subtitle === undefined ? undefined : (
          <span className="settings__subtitle">{subtitle}</span>
        )}
      </div>
    </div>
    {children}
  </div>
)
