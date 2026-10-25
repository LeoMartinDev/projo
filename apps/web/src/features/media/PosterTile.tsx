import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import type { ItemSummaryDto } from '@projo/shared/api/catalog'

import { itemTitle } from '../../shared/i18n/item-titles.ts'
import { Artwork } from '../../shared/ui/Artwork.tsx'
import { CheckIcon } from '../../shared/ui/icons.tsx'
import {
  isWatched,
  partialCountOf,
  posterOf,
  progressRatioOf,
  toneOf,
  yearsLabel,
} from './media.ts'
import { useLongPress } from './use-long-press.ts'
import './media.css'

/**
 * 2:3 tile of Movies, Shows, My list and the search (§13.4). With a poster the title stays in
 * the text for assistive technologies; without one (no TMDB match yet, image missing) the tile
 * shows the title and the year on its tone.
 */
export const PosterTile = ({
  item,
  onLongPress,
  tabIndex,
  id,
}: {
  item: ItemSummaryDto
  onLongPress?: (item: ItemSummaryDto) => void
  tabIndex?: number
  id?: string
}) => {
  const { t } = useTranslation()
  const press = useLongPress(() => onLongPress?.(item))
  const ratio = progressRatioOf(item)
  const partial = partialCountOf(item)
  const watched = isWatched(item)
  return (
    <Link
      to="/items/$itemId"
      params={{ itemId: item.id }}
      className={`poster tone-${toneOf(item.id)}`}
      {...(tabIndex === undefined ? {} : { tabIndex })}
      {...(id === undefined ? {} : { id })}
      {...(onLongPress === undefined ? {} : press)}
    >
      <Artwork src={posterOf(item)} className="cover-img poster__img" />
      <span className="poster__caption">
        <span className="poster__title">{itemTitle(t, item)}</span>
        {item.year === undefined ? undefined : (
          <span className="poster__year">{yearsLabel(item)}</span>
        )}
      </span>
      {watched ? (
        <span className="poster__watched" title={t('catalog.watched')}>
          <CheckIcon size={14} />
          <span className="visually-hidden">{t('catalog.watched')}</span>
        </span>
      ) : undefined}
      {ratio !== undefined ? (
        <progress
          className="bar poster__progress"
          value={ratio}
          max={1}
          aria-label={t('catalog.inProgress')}
        />
      ) : partial !== undefined ? (
        <progress
          className="bar poster__progress"
          value={partial.watched}
          max={partial.total}
          aria-label={t('catalog.watchedOf', partial)}
        />
      ) : undefined}
    </Link>
  )
}

export const PosterSkeleton = () => (
  <span className="poster poster--skeleton skeleton" aria-hidden="true" />
)
