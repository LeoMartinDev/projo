import { type ReactNode, useId } from 'react'

import './settings.css'

/** A titled well grouping settings rows and forms on a settings page; `action` sits by the title. */
export const SettingsPanel = ({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) => {
  const id = useId()
  const heading = (
    <h2 id={id} className="settings-panel__title">
      {title}
    </h2>
  )
  return (
    <section className="settings-panel" aria-labelledby={id}>
      {action === undefined ? (
        heading
      ) : (
        <div className="settings-panel__head">
          {heading}
          {action}
        </div>
      )}
      <div className="settings-panel__body">{children}</div>
    </section>
  )
}
