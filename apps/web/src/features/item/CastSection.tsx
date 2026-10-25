import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { PersonDto } from '@projo/shared/api/catalog'

import { Artwork } from '../../shared/ui/Artwork.tsx'
import { ChevronLeftIcon, ChevronRightSmallIcon } from '../../shared/ui/media-icons.tsx'
import { useElement } from '../../shared/ui/use-element.ts'

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase())
    .join('')

/** Casting with photos (§13.5, §9.1: 20 first actors), then the creators or directors. */
export const CastSection = ({
  cast,
  crew,
  series,
}: {
  cast: PersonDto[]
  crew: PersonDto[]
  series: boolean
}) => {
  const { t } = useTranslation()
  const [list, listRef] = useElement<HTMLUListElement>()
  const [reach, setReach] = useState({ prev: false, next: false })
  const people = [...cast, ...crew]
  const count = people.length

  /** Which arrows can still move: follows the scroll position and the width of the row. */
  useEffect(() => {
    if (list === undefined) return
    const update = () =>
      setReach({
        prev: list.scrollLeft > 1,
        next: list.scrollLeft + list.clientWidth < list.scrollWidth - 1,
      })
    update()
    list.addEventListener('scroll', update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(list)
    return () => {
      list.removeEventListener('scroll', update)
      observer.disconnect()
    }
  }, [list, count])

  if (count === 0) return undefined

  const page = (direction: -1 | 1) =>
    list?.scrollBy({ left: direction * list.clientWidth * 0.8, behavior: 'smooth' })

  return (
    <section className="detail-section" aria-labelledby="cast-title">
      <div className="detail-section__head">
        <h2 id="cast-title" className="detail-section__title">
          {t('item.cast')}
        </h2>
        {reach.prev || reach.next ? (
          <span className="row__pager cast__pager">
            <button
              type="button"
              className="row__arrow"
              aria-label={t('home.previous')}
              disabled={!reach.prev}
              onClick={() => page(-1)}
            >
              <ChevronLeftIcon />
            </button>
            <button
              type="button"
              className="row__arrow"
              aria-label={t('home.next')}
              disabled={!reach.next}
              onClick={() => page(1)}
            >
              <ChevronRightSmallIcon />
            </button>
          </span>
        ) : undefined}
      </div>
      <ul ref={listRef} className="cast">
        {people.map((person) => (
          <li key={`${person.id}-${person.role}`} className="cast__person">
            <span className="cast__photo" aria-hidden="true">
              <Artwork
                src={person.photo}
                className="cover-img"
                fallback={<span className="cast__initials">{initials(person.name)}</span>}
              />
            </span>
            <span className="cast__name">{person.name}</span>
            <span className="cast__role">
              {person.role === 'cast'
                ? (person.character ?? '')
                : person.role === 'director'
                  ? t('item.director')
                  : series
                    ? t('item.creator')
                    : t('item.writer')}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
