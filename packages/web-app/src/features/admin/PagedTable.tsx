import { type ReactNode, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { BackIcon, ChevronRightIcon } from '../../shared/ui/icons.tsx'
import { useElement } from '../../shared/ui/use-element.ts'
import type { CursorPagesState } from './use-cursor-pages.ts'

/** Turns the pages of a cursor-paginated list: previous, the shown page's number, next. */
export const Pager = ({
  pages,
  nextCursor,
  changing,
}: {
  pages: CursorPagesState
  nextCursor: string | undefined
  changing: boolean
}) => {
  const { t } = useTranslation()
  return (
    <nav className="adm-pager" aria-label={t('admin.pager.label')}>
      <button
        type="button"
        className="button button--glass button--small adm-pager__step"
        disabled={pages.page === 1}
        aria-label={t('admin.pager.previous')}
        onClick={pages.previous}
      >
        <BackIcon size={16} />
      </button>
      <span className="adm-pager__page" aria-live="polite">
        {changing ? <span className="spinner" aria-hidden="true" /> : undefined}
        {t('admin.pager.page', { page: pages.page })}
      </span>
      <button
        type="button"
        className="button button--glass button--small adm-pager__step"
        disabled={nextCursor === undefined || changing}
        aria-label={t('admin.pager.next')}
        onClick={() => {
          if (nextCursor !== undefined) pages.next(nextCursor)
        }}
      >
        <ChevronRightIcon size={16} />
      </button>
    </nav>
  )
}

/**
 * A technical table (logs, jobs) that fills the page's height: its rows scroll under a header
 * that stays, the pages are turned below it. `changing` while the next page loads (the shown
 * rows stay until then); the rows scroll back to the top once it is shown (on a phone, where the
 * page scrolls, the page back to the table).
 */
export const PagedTable = ({
  label,
  head,
  children,
  pages,
  nextCursor,
  changing,
}: {
  label: string
  head: ReactNode
  children: ReactNode
  pages: CursorPagesState
  nextCursor: string | undefined
  changing: boolean
}) => {
  const [scroller, scrollerRef] = useElement<HTMLDivElement>()
  const { view } = pages
  useEffect(() => {
    if (changing || scroller === undefined) return
    if (scroller.scrollTop > 0) scroller.scrollTo({ top: 0 })
    else if (scroller.getBoundingClientRect().top < 0) scroller.scrollIntoView({ block: 'start' })
  }, [scroller, view, changing])
  return (
    <div className="adm-paged">
      <div
        ref={scrollerRef}
        className="adm-table adm-table--dense adm-paged__table"
        role="table"
        aria-label={label}
        aria-busy={changing}
      >
        {head}
        <div className="adm-table__body">{children}</div>
      </div>
      <Pager pages={pages} nextCursor={nextCursor} changing={changing} />
    </div>
  )
}
