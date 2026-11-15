import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { genreLabels } from '@projo/i18n/genres'
import { itemTitle } from '@projo/i18n/item-titles'
import type { ItemDetailDto, PersonDto } from '@projo/shared/api/catalog'

import { formatScore } from '../../shared/format/format.ts'

import { currentLocale } from '../../shared/i18n/index.ts'
import { Artwork, fullWidthSizes, logoSizes } from '../../shared/ui/Artwork.tsx'
import { BackLink } from '../../shared/ui/BackLink.tsx'
import { ChevronLeftIcon } from '../../shared/ui/media-icons.tsx'
import { qualityLabel, toneOf, yearsLabel } from '../media/media.ts'
import { RatingBadge, useRatingBadge } from '../media/RatingBadge.tsx'
import { Score } from '../media/Score.tsx'

const names = (people: readonly PersonDto[], max: number) =>
  people
    .slice(0, max)
    .map((person) => person.name)
    .join(', ')

export const CreditsLine = ({ item }: { item: ItemDetailDto }) => {
  const { t } = useTranslation()
  const cast = item.cast.filter((person) => person.role === 'cast')
  const makers = item.crew.filter((person) =>
    item.kind === 'series' ? person.role === 'writer' : person.role === 'director',
  )
  if (cast.length === 0 && makers.length === 0) return undefined
  return (
    <p className="detail-hero__credits">
      {cast.length === 0 ? undefined : (
        <span>
          {t('item.with')} <span className="detail-hero__names">{names(cast, 3)}</span>
        </span>
      )}
      {makers.length === 0 ? undefined : (
        <span>
          {item.kind === 'series' ? t('item.createdBy') : t('item.directedBy')}{' '}
          <span className="detail-hero__names">{names(makers, 2)}</span>
        </span>
      )}
    </p>
  )
}

export const MetaLine = ({ item, extra }: { item: ItemDetailDto; extra?: string }) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const ratingBadge = useRatingBadge()
  const quality = qualityLabel(item.bestQuality)
  const parts = [
    yearsLabel(item),
    extra,
    item.genres.length === 0 ? undefined : genreLabels(t, item.genres, 3).join(', '),
  ].filter((part) => part !== undefined)
  return (
    <div className="detail-hero__meta">
      <RatingBadge badge={ratingBadge(item.contentRating)} />
      {parts.map((part) => (
        <span key={part} className="detail-hero__meta-part">
          {part}
        </span>
      ))}
      {quality === undefined ? undefined : <span className="rating-badge">{quality}</span>}
      <Score score={formatScore(item.voteAverage, locale)} />
    </div>
  )
}

export const DetailHero = ({
  item,
  backdrop,
  eyebrow,
  children,
}: {
  item: ItemDetailDto
  backdrop: string | undefined
  eyebrow?: ReactNode
  children: ReactNode
}) => {
  const { t } = useTranslation()
  const title = itemTitle(t, item)
  return (
    <section className="detail-hero" aria-labelledby="detail-title">
      <div className={`detail-hero__media tone-${toneOf(item.id)}`} aria-hidden="true">
        <Artwork
          src={backdrop}
          className="cover-img detail-hero__img"
          eager
          sizes={fullWidthSizes}
        />
        <span className="detail-hero__shade" />
      </div>
      <div className="detail-hero__top">
        <BackLink className="detail-hero__back">
          <ChevronLeftIcon size={18} />
          <span className="detail-hero__back-label">{t('common.back')}</span>
        </BackLink>
      </div>
      <div className="detail-hero__content">
        {eyebrow}
        <h1 id="detail-title" className="detail-hero__title rise r1">
          {item.kind === 'episode' ? (
            title
          ) : (
            <Artwork
              src={item.images.logo}
              alt={title}
              className="detail-hero__logo"
              eager
              sizes={logoSizes}
              fallback={title}
            />
          )}
        </h1>
        {children}
      </div>
    </section>
  )
}
