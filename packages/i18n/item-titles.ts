import type { TFunction } from 'i18next'

import type { ItemKind } from '@projo/shared/api/catalog'

export type Titled = {
  kind: ItemKind
  title?: string | undefined
  seasonNumber?: number | undefined
  episodeNumber?: number | undefined
}

export const episodeCode = (
  season: number | undefined,
  episode: number | undefined,
  labels: { season: string; episode: string },
): string =>
  [
    season === undefined ? undefined : `${labels.season}${season}`,
    episode === undefined ? undefined : `${labels.episode}${episode}`,
  ]
    .filter((part) => part !== undefined)
    .join(' · ')

export const seasonLabel = (t: TFunction, seasonNumber: number): string =>
  seasonNumber === 0 ? t('item.specials') : t('item.season', { number: seasonNumber })

export const episodeLabel = (t: TFunction, episodeNumber: number): string =>
  t('item.episodeNumber', { number: episodeNumber })

export const itemTitle = (t: TFunction, item: Titled): string => {
  if (item.title !== undefined) return item.title
  if (item.kind === 'season' && item.seasonNumber !== undefined)
    return seasonLabel(t, item.seasonNumber)
  if (item.kind === 'episode' && item.episodeNumber !== undefined)
    return episodeLabel(t, item.episodeNumber)
  return ''
}

const codeOf = (t: TFunction, item: Titled): string =>
  episodeCode(item.seasonNumber, item.episodeNumber, {
    season: t('item.seasonShort'),
    episode: t('item.episodeShort'),
  })

export const episodeLine = (
  t: TFunction,
  item: Titled,
  style: 'quoted' | 'dotted' = 'quoted',
): string => {
  const code = codeOf(t, item)
  if (item.title === undefined || code === '') return code || itemTitle(t, item)
  return style === 'quoted'
    ? `${code} ${t('card.quoted', { title: item.title })}`
    : `${code} · ${item.title}`
}

export const listedNumber = (
  episode: Titled & { episodeNumberEnd?: number | undefined },
  number: string | undefined,
): string | undefined =>
  episode.title === undefined && episode.episodeNumberEnd === undefined ? undefined : number

export const playEpisodeLabel = (t: TFunction, episode: Titled, number: string): string =>
  episode.title === undefined
    ? t('item.playEpisodeNumberOnly', { number })
    : t('item.playEpisodeNumber', { number, title: episode.title })

export const itemWithSeriesLabel = (
  t: TFunction,
  item: Titled & { seriesTitle?: string | undefined },
): string => {
  const parts =
    item.kind === 'episode'
      ? [item.seriesTitle, codeOf(t, item), item.seriesTitle === undefined ? item.title : undefined]
      : [item.kind === 'season' ? item.seriesTitle : undefined, itemTitle(t, item)]
  const named = parts.filter((part) => part !== undefined && part !== '')
  return named.length === 0 ? itemTitle(t, item) : named.join(' · ')
}

export const chapterLabel = (
  t: TFunction,
  chapter: { title?: string | undefined },
  index: number,
): string => chapter.title ?? t('player.menu.chapterNumber', { number: index + 1 })
