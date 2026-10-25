import { Link } from '@tanstack/react-router'
import {
  type FocusEvent,
  type ReactNode,
  type WheelEvent,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useTranslation } from 'react-i18next'

import type { GenreId } from '@projo/shared/api/genres'

import { ChevronLeftIcon, ChevronRightSmallIcon } from '../../shared/ui/media-icons.tsx'
import { useElement } from '../../shared/ui/use-element.ts'

const gapPx = 14

const finePointer = '(hover: hover) and (pointer: fine)'
const subscribePointer = (notify: () => void) => {
  const query = window.matchMedia(finePointer)
  query.addEventListener('change', notify)
  return () => query.removeEventListener('change', notify)
}

/**
 * Mouse and trackpad: rows page with the arrows (artboard `Home`) so the card previews can grow
 * over their neighbours. Touch screens scroll the row natively.
 */
const useFinePointer = () =>
  useSyncExternalStore(
    subscribePointer,
    () => window.matchMedia(finePointer).matches,
    () => true,
  )

const wideCards = [0, 1, 2, 3, 4]
const posterCards = [0, 1, 2, 3, 4, 5, 6, 7]

/**
 * A row while it loads: the same boxes as a row of wide cards, or of 2:3 posters (`poster`, the
 * category rows), so nothing moves after.
 */
export const RowSkeleton = ({ poster = false }: { poster?: boolean }) => {
  const paged = useFinePointer()
  return (
    <div className="row">
      <div className="row__head">
        <span className="skeleton skeleton--line row__skeleton-title" />
      </div>
      <div className={paged ? 'row__viewport row__viewport--paged' : 'row__viewport'}>
        <div className={poster ? 'row__track row__track--poster' : 'row__track'}>
          {(poster ? posterCards : wideCards).map((card) => (
            <span key={card} className={poster ? 'cw cw--poster' : 'cw'}>
              <span className="card">
                <span className="skeleton card__skeleton" />
                {poster ? undefined : (
                  <span className="card__caption">
                    <span className="skeleton skeleton--line card__skeleton-caption" />
                  </span>
                )}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

/** "See all ›": Movies / Shows sorted by addition (and on a genre: a genre row), or My list. */
export type SeeAll =
  { to: '/movies' | '/series'; sort: 'added'; genre?: GenreId } | { to: '/watchlist' }

/** A home row (§13.3): title, "See all ›", previous / next, the cards. */
export const Row = ({
  id,
  title,
  seeAll,
  count,
  poster = false,
  children,
}: {
  id: string
  title: string
  seeAll?: SeeAll
  count: number
  poster?: boolean
  children: ReactNode
}) => {
  const { t } = useTranslation()
  const paged = useFinePointer()
  const [viewport, viewportRef] = useElement<HTMLDivElement>()
  const [track, trackRef] = useElement<HTMLDivElement>()
  const [size, setSize] = useState({ view: 0, content: 0 })
  const [page, setPage] = useState(0)
  const wheel = useRef({ delta: 0, until: 0 })

  useEffect(() => {
    if (viewport === undefined || track === undefined) return
    const observer = new ResizeObserver(() =>
      setSize({ view: viewport.clientWidth, content: track.scrollWidth }),
    )
    observer.observe(viewport)
    observer.observe(track)
    return () => observer.disconnect()
  }, [viewport, track, count])

  const step = size.view + gapPx
  const maxOffset = Math.max(0, size.content - size.view)
  const offset = paged ? Math.min(page * step, maxOffset) : 0
  const lastPage = step > 0 ? Math.ceil(maxOffset / step) : 0
  const canPrev = paged && offset > 0
  const canNext = paged && offset < maxOffset - 1

  const goTo = (next: number) => setPage(Math.max(0, Math.min(lastPage, next)))

  /** Keyboard: a card reached with Tab brings its page into view. */
  const reveal = (event: FocusEvent<HTMLDivElement>) => {
    if (!paged || step <= 0) return
    const card = (event.target as HTMLElement).closest<HTMLElement>('.cw')
    if (!card || card.parentElement !== event.currentTarget) return
    const start = card.offsetLeft
    if (start < offset || start + card.offsetWidth > offset + size.view)
      goTo(Math.floor(start / step))
  }

  /** Horizontal trackpad swipes turn the pages. */
  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!paged || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return
    const now = event.timeStamp
    if (now < wheel.current.until) return
    wheel.current.delta += event.deltaX
    if (Math.abs(wheel.current.delta) < 60) return
    goTo(page + (wheel.current.delta > 0 ? 1 : -1))
    wheel.current = { delta: 0, until: now + 650 }
  }

  return (
    <section className="row" aria-labelledby={id}>
      <div className="row__head">
        <h2 id={id} className="row__title">
          {title}
        </h2>
        {seeAll === undefined ? undefined : seeAll.to === '/watchlist' ? (
          <Link to="/watchlist" className="row__see">
            {t('home.seeAll')}
          </Link>
        ) : (
          <Link
            to={seeAll.to}
            search={{
              sort: seeAll.sort,
              ...(seeAll.genre === undefined ? {} : { genre: seeAll.genre }),
            }}
            className="row__see"
          >
            {t('home.seeAll')}
          </Link>
        )}
        <span className="row__spacer" />
        {paged && maxOffset > 0 ? (
          <span className="row__pager">
            <button
              type="button"
              className="row__arrow"
              aria-label={t('home.previous')}
              disabled={!canPrev}
              onClick={() => goTo(page - 1)}
            >
              <ChevronLeftIcon />
            </button>
            <button
              type="button"
              className="row__arrow"
              aria-label={t('home.next')}
              disabled={!canNext}
              onClick={() => goTo(page + 1)}
            >
              <ChevronRightSmallIcon />
            </button>
          </span>
        ) : undefined}
      </div>
      <div
        ref={viewportRef}
        className={paged ? 'row__viewport row__viewport--paged' : 'row__viewport'}
        onWheel={onWheel}
      >
        <div
          ref={trackRef}
          className={poster ? 'row__track row__track--poster' : 'row__track'}
          style={paged ? { transform: `translate3d(${-offset}px, 0, 0)` } : undefined}
          onFocus={reveal}
        >
          {children}
        </div>
      </div>
    </section>
  )
}
