import { useTranslation } from 'react-i18next'

import type { ItemSummaryDto } from '@projo/shared/api/catalog'

import { formatDuration } from '../../shared/format/format.ts'
import { currentLocale } from '../../shared/i18n/index.ts'
import { episodeLine, itemTitle } from '../../shared/i18n/item-titles.ts'
import {
  cardTitleOf,
  durationMsOf,
  episodeLabelOf,
  partialCountOf,
  remainingMsOf,
  yearsLabel,
} from './media.ts'

/** Where a card is shown: the home rows of §13.3 (`category`: Anime, genres), a grid, search. */
export type CardPlace =
  'continue_watching' | 'up_next' | 'recently_added' | 'watchlist' | 'category' | 'grid' | 'search'

/** 2:3 posters on the home (§19): Recently added and the category rows. */
export const isPosterPlace = (place: CardPlace): boolean =>
  place === 'recently_added' || place === 'category'

/** Time left rounded up to the minute: "1 min" rather than "0 min" near the end. */
export const formatRemaining = (ms: number, locale: string) =>
  formatDuration(Math.ceil(Math.max(ms, 1) / 60_000) * 60_000, locale)

export type CardText = {
  /** Big title on the picture (an episode shows its series). */
  title: string
  /** `S2 · E4` of an episode. */
  code?: string
  /** Line under the picture, left: "S2 · E4 · Coefficient 112", "Movie · 2024". */
  sub: string
  /** Line under the picture, right: time left, running time, "3 / 9 vus". */
  right?: string
  /**
   * Preview and sheet line: "S2 · E4 “Coefficient 112”", "Movie · 2024",
   * "Show · 2 seasons · 2023 – 2025".
   */
  line: string
  duration?: string
  /** "18 min restantes". */
  remaining?: string
}

/** The words of a card (artboards `Home`, `MobileHome`). */
export const useCardText = () => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const labels = { season: t('item.seasonShort'), episode: t('item.episodeShort') }
  return (item: ItemSummaryDto, place: CardPlace): CardText => {
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
    const title = itemTitle(t, item)
    const sub = item.kind === 'episode' ? episodeLine(t, item, 'dotted') : typed
    const line = item.kind === 'episode' ? episodeLine(t, item) : typed
    const right =
      place === 'continue_watching'
        ? remaining
        : partial !== undefined
          ? t('catalog.watchedOf', partial)
          : duration
    return {
      title: cardTitleOf(item) ?? title,
      ...(code === undefined ? {} : { code }),
      sub,
      ...(right === undefined ? {} : { right }),
      line,
      ...(duration === undefined ? {} : { duration }),
      ...(remaining === undefined
        ? {}
        : { remaining: t('item.remaining', { duration: remaining }) }),
    }
  }
}
