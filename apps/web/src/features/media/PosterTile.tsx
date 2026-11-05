import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

import { itemTitle } from '@projo/i18n/item-titles'
import type { ItemSummaryDto } from '@projo/shared/api/catalog'

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

export const PosterTile = ({
  item,
  sizes,
  onLongPress,
  tabIndex,
  id,
}: {
  item: ItemSummaryDto
  sizes: string
  onLongPress?: (item: ItemSummaryDto, anchor: HTMLElement) => void
  tabIndex?: number
  id?: string
}) => {
  const { t } = useTranslation()
  const press = useLongPress((anchor) => onLongPress?.(item, anchor))
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
      <Artwork src={posterOf(item)} className="cover-img poster__img" sizes={sizes} eager />
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
