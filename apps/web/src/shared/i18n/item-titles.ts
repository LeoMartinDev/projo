import type { TFunction } from 'i18next'

import type { ItemKind } from '@projo/shared/api/catalog'

import { episodeCode } from '../format/format.ts'

/**
 * §6.3: a season or an episode without a name of its own has no `title` in the API (its TMDB or
 * file name was "Saison 2", "Episode 7"…); its label is built from its number in the interface
 * language. Same for chapters with a muxer default name ("Chapter 01", §10.7).
 */

export type Titled = {
  kind: ItemKind
  title?: string | undefined
  seasonNumber?: number | undefined
  episodeNumber?: number | undefined
}

/** "Season 2", "Specials" for season 0. */
export const seasonLabel = (t: TFunction, seasonNumber: number): string =>
  seasonNumber === 0 ? t('item.specials') : t('item.season', { number: seasonNumber })

/** "Episode 7". */
export const episodeLabel = (t: TFunction, episodeNumber: number): string =>
  t('item.episodeNumber', { number: episodeNumber })

/** The item's title, or the label of its number when it has none. */
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

/**
 * An episode on a line that shows its code: "S2 · E4 “Coefficient 112”" (`quoted`: previews,
 * player, hero) or "S2 · E4 · Coefficient 112" (`dotted`: card captions). Without a title of its
 * own, only the code: its number is already there (not "S1 · E7 “Episode 7”"). Without numbers
 * either, the label of `itemTitle`.
 */
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

/**
 * The number before an episode's name in a list ("4. Coefficient 112"): none when the name is
 * built from that number ("Episode 7", not "7. Episode 7"), kept for a double episode ("7-8").
 */
export const listedNumber = (
  episode: Titled & { episodeNumberEnd?: number | undefined },
  number: string | undefined,
): string | undefined =>
  episode.title === undefined && episode.episodeNumberEnd === undefined ? undefined : number

/** "Play episode 4, “Coefficient 112”", or "Play episode 7" without a title of its own. */
export const playEpisodeLabel = (t: TFunction, episode: Titled, number: string): string =>
  episode.title === undefined
    ? t('item.playEpisodeNumberOnly', { number })
    : t('item.playEpisodeNumber', { number, title: episode.title })

/**
 * An item named with its series, for the admin lists: "Severance · S2 · E4" (the episode code,
 * not its title), "Severance · Season 2", "Dune". An episode without its series keeps its own
 * title after the code.
 */
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

/** A chapter's name, or "Chapitre 3" (`index` from 0). */
export const chapterLabel = (
  t: TFunction,
  chapter: { title?: string | undefined },
  index: number,
): string => chapter.title ?? t('player.menu.chapterNumber', { number: index + 1 })
