import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'

import { ratingBadge } from '@projo/i18n/content-ratings'
import { formatDuration } from '@projo/i18n/format'
import { episodeLine, itemTitle } from '@projo/i18n/item-titles'
import {
  cardTitleOf,
  durationMsOf,
  episodeLabelOf,
  partialCountOf,
  remainingMsOf,
  yearsLabel,
} from '@projo/i18n/media'
import type { ItemSummaryDto, PlayTargetDto } from '@projo/shared/api/catalog'

/** Where a card is shown: the home rows of §13.3 (`category`: Anime, genres), a grid. */
export type CardPlace =
  'continue_watching' | 'up_next' | 'recently_added' | 'watchlist' | 'category' | 'grid'

/** 2:3 posters on the home (§19): Recently added and the category rows. */
export const isPosterPlace = (place: CardPlace): boolean =>
  place === 'recently_added' || place === 'category'

/** The interface language, for `Intl`. */
export const useLocale = (): string => {
  const { i18n } = useTranslation()
  return i18n.resolvedLanguage ?? i18n.language
}

/** Time left rounded up to the minute: "1 min" rather than "0 min" near the end. */
export const formatRemaining = (ms: number, locale: string) =>
  formatDuration(Math.ceil(Math.max(ms, 1) / 60_000) * 60_000, locale)

/**
 * The main button of a series (hero, title page, §13.5): "Resume S2 · E4", "Play S1 · E3" once
 * started, "Resume" or "Play" otherwise.
 */
export const playLabelOf = (
  t: TFunction,
  item: Pick<ItemSummaryDto, 'kind' | 'watchStatus'>,
  play: PlayTargetDto | undefined,
): string => {
  const labels = { season: t('item.seasonShort'), episode: t('item.episodeShort') }
  const code = play === undefined ? undefined : episodeLabelOf({ kind: 'episode', ...play }, labels)
  const series = item.kind === 'series' && code !== undefined
  const started =
    (item.watchStatus?.watchedCount ?? 0) + (item.watchStatus?.inProgressCount ?? 0) > 0
  if (play?.action === 'resume')
    return series ? t('item.resumeEpisode', { episode: code }) : t('card.resume')
  return series && started ? t('item.playEpisodeCode', { episode: code }) : t('item.play')
}

/** The words of a card (artboard `MobileHome`), the web's `useCardText`. */
export const useCardText = () => {
  const { t } = useTranslation()
  const locale = useLocale()
  const labels = { season: t('item.seasonShort'), episode: t('item.episodeShort') }
  return (item: ItemSummaryDto, place: CardPlace) => {
    const code = episodeLabelOf(item, labels)
    const durationMs = durationMsOf(item)
    const duration = durationMs === undefined ? undefined : formatDuration(durationMs, locale)
    const remainingMs = remainingMsOf(item)
    const remaining = remainingMs === undefined ? undefined : formatRemaining(remainingMs, locale)
    const kindLabel =
      item.kind === 'series'
        ? t('card.series')
        : item.kind === 'movie'
          ? t('card.movie')
          : undefined
    const seasons =
      item.kind === 'series' && item.seasonCount !== undefined && item.seasonCount > 0
        ? t('item.seasonCount', { count: item.seasonCount })
        : undefined
    const typed = [kindLabel, seasons, yearsLabel(item)]
      .filter((part) => part !== undefined)
      .join(' · ')
    const partial = partialCountOf(item)
    const right =
      place === 'continue_watching'
        ? remaining
        : partial !== undefined
          ? t('catalog.watchedOf', partial)
          : duration
    return {
      title: cardTitleOf(item) ?? itemTitle(t, item),
      code,
      /** Under the picture, left: "S2 · E4 · Coefficient 112", "Movie · 2024". */
      sub: item.kind === 'episode' ? episodeLine(t, item, 'dotted') : typed,
      /** Under the picture, right: time left, running time, "3 / 9 watched". */
      right,
      /** The sheet's line: "S2 · E4 “Coefficient 112”", "Show · 2 seasons · 2023 – 2025". */
      line: item.kind === 'episode' ? episodeLine(t, item) : typed,
      duration,
      remaining: remaining === undefined ? undefined : t('item.remaining', { duration: remaining }),
      rating: ratingBadge(t, locale, item.contentRating),
    }
  }
}
