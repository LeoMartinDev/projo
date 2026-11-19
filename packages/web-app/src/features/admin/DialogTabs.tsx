import type { KeyboardEvent, ReactNode } from 'react'

import './admin.css'

export type DialogTab<T extends string> = { value: T; label: string }

const tabId = (idPrefix: string, value: string) => `${idPrefix}-tab-${value}`
const panelId = (idPrefix: string, value: string) => `${idPrefix}-panel-${value}`

const keyTargets: Readonly<Record<string, (index: number, count: number) => number>> = {
  ArrowRight: (index, count) => (index + 1) % count,
  ArrowLeft: (index, count) => (index - 1 + count) % count,
  Home: () => 0,
  End: (_index, count) => count - 1,
}

/**
 * The tabs of a record's dialog (a library, an account): drawn like a section's tabs
 * (AdminSection), but a tablist switching panels in place. Arrow keys, Home and End move between
 * them.
 */
export const DialogTabs = <T extends string>({
  idPrefix,
  label,
  tabs,
  value,
  onChange,
}: {
  idPrefix: string
  label: string
  tabs: readonly DialogTab<T>[]
  value: T
  onChange: (value: T) => void
}) => {
  // A tab starts at its top, not where the previous one was scrolled to.
  const select = (next: T, from: HTMLElement) => {
    onChange(next)
    from.closest('dialog')?.querySelector('.dialog__body')?.scrollTo({ top: 0 })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = keyTargets[event.key]
    if (target === undefined) return
    event.preventDefault()
    const index = tabs.findIndex((tab) => tab.value === value)
    const next = tabs[target(index, tabs.length)]
    if (next === undefined) return
    select(next.value, event.currentTarget)
    document.getElementById(tabId(idPrefix, next.value))?.focus()
  }
  return (
    <div className="admin-tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((tab) => {
        const current = tab.value === value
        return (
          <button
            key={tab.value}
            id={tabId(idPrefix, tab.value)}
            type="button"
            role="tab"
            className="admin-tabs__tab"
            aria-selected={current}
            aria-controls={panelId(idPrefix, tab.value)}
            tabIndex={current ? 0 : -1}
            onClick={(event) => select(tab.value, event.currentTarget)}
          >
            <span className="admin-tabs__label">{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}

/** A tab's panel: kept mounted while hidden, so what is typed in it survives a change of tab. */
export const DialogTabPanel = ({
  idPrefix,
  value,
  current,
  className,
  children,
}: {
  idPrefix: string
  value: string
  current: string
  className?: string
  children: ReactNode
}) => (
  <div
    id={panelId(idPrefix, value)}
    role="tabpanel"
    aria-labelledby={tabId(idPrefix, value)}
    className={className === undefined ? 'dialog-panel' : `dialog-panel ${className}`}
    hidden={value !== current}
  >
    {children}
  </div>
)
