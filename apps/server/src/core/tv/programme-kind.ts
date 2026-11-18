import type { TvProgrammeKind } from '@projo/shared/api/tv'

import type { TvGuideText } from './guide.ts'

export type { TvProgrammeKind }

/** A kind's words, lowercased without accents; a phrase is several words (§29.3). */
type KeywordTable = Partial<Record<Exclude<TvProgrammeKind, 'other'>, readonly string[]>>

/** When one text names several kinds, the first of this order wins (§29.3). */
const kindOrder = [
  'kids',
  'sport',
  'news',
  'documentary',
  'movie',
  'series',
  'music',
  'entertainment',
] as const satisfies readonly Exclude<TvProgrammeKind, 'other'>[]

/** Words joined before matching, so they name one thing (`science fiction` is not science). */
const compounds: readonly (readonly [RegExp, string])[] = [
  [/\bscience fiction\b/gu, 'scifi'],
  [/\barts martiaux\b/gu, 'martialarts'],
  [/\bmartial arts\b/gu, 'martialarts'],
]

const english: KeywordTable = {
  kids: ['kid', 'children', 'child', 'youth', 'cartoon', 'animated', 'animation', 'preschool'],
  sport: [
    'sport',
    'football',
    'soccer',
    'rugby',
    'tennis',
    'golf',
    'basketball',
    'cycling',
    'motorsport',
    'formula 1',
    'athletics',
    'boxing',
    'hockey',
    'baseball',
    'cricket',
    'olympic',
    'wrestling',
    'martialarts',
  ],
  news: ['news', 'current affairs', 'weather', 'politic', 'economics', 'newsmagazine'],
  documentary: [
    'documentar',
    'docu',
    'factual',
    'nature',
    'science',
    'history',
    'historical',
    'education',
    'wildlife',
    'arts',
    'culture',
  ],
  movie: ['movie', 'film', 'feature', 'cinema', 'scifi'],
  series: ['series', 'sitcom', 'soap', 'drama', 'telenovela'],
  music: ['music', 'concert', 'opera', 'ballet'],
  entertainment: [
    'entertainment',
    'game show',
    'gameshow',
    'quiz',
    'reality',
    'talk show',
    'comedy',
    'variety',
    'show',
    'lifestyle',
    'leisure',
    'hobbies',
    'cooking',
  ],
}

const french: KeywordTable = {
  kids: ['jeunesse', 'enfant', 'dessin anime', 'dessins animes', 'animation', 'junior'],
  sport: [
    'sport',
    'football',
    'foot',
    'rugby',
    'tennis',
    'cyclisme',
    'golf',
    'basket',
    'handball',
    'formule 1',
    'athletisme',
    'boxe',
    'natation',
    'equitation',
    'jeux olympiques',
    'martialarts',
  ],
  news: ['information', 'info', 'journal', 'actualite', 'meteo', 'debat', 'politique', 'economie'],
  documentary: [
    'documentaire',
    'docu',
    'histoire',
    'nature',
    'science',
    'decouverte',
    'reportage',
    'animalier',
    'culture',
  ],
  movie: ['film', 'cinema', 'telefilm', 'long metrage', 'court metrage', 'scifi'],
  series: ['serie', 'feuilleton', 'sitcom', 'saga', 'soap', 'telenovela'],
  music: ['musique', 'musical', 'concert', 'clip', 'opera', 'chanson', 'ballet'],
  entertainment: [
    'divertissement',
    'jeu',
    'emission',
    'magazine',
    'telerealite',
    'talk show',
    'humour',
    'spectacle',
    'variete',
    'show',
    'cuisine',
    'loisirs',
    'theatre',
  ],
}

/** The words of a channel's group or name (§29.3), both languages. */
const channelWords: KeywordTable = {
  kids: ['kid', 'junior', 'jeunesse', 'enfant', 'cartoon', 'toon', 'baby', 'children'],
  sport: ['sport', 'foot', 'golf', 'tennis', 'rugby', 'fight', 'racing'],
  news: ['news', 'info', 'actu', 'journal', 'meteo', 'weather', 'parlement'],
  documentary: [
    'docu',
    'histoire',
    'history',
    'nature',
    'science',
    'decouverte',
    'discovery',
    'wild',
    'animaux',
    'animal',
    'voyage',
    'travel',
  ],
  movie: ['cine', 'film', 'movie'],
  series: ['serie', 'fiction', 'novela'],
  music: ['musi', 'hits', 'clip', 'concert'],
  entertainment: ['comedy', 'comedie', 'divertissement', 'entertainment', 'reality', 'fun'],
}

/**
 * The English DVB EIT content strings (EN 300 468), as XMLTV grabbers write them: a whole
 * category matching one gives its kind before any keyword.
 */
const dvbContents: Record<string, Exclude<TvProgrammeKind, 'other'>> = {
  'movie drama': 'movie',
  'detective thriller': 'movie',
  'adventure western war': 'movie',
  'scifi fantasy horror': 'movie',
  'soap melodrama folklore': 'series',
  'serious classical religious historical movie drama': 'movie',
  'adult movie drama': 'movie',
  'news current affairs': 'news',
  'news weather report': 'news',
  'news magazine': 'news',
  documentary: 'documentary',
  'discussion interview debate': 'news',
  'show game show': 'entertainment',
  'game show quiz contest': 'entertainment',
  'variety show': 'entertainment',
  'talk show': 'entertainment',
  sports: 'sport',
  'special events': 'sport',
  'sports magazine': 'sport',
  'children s youth programs': 'kids',
  'children s youth programmes': 'kids',
  'pre school children s programs': 'kids',
  'pre school children s programmes': 'kids',
  'entertainment programs for 6 to 14': 'kids',
  'entertainment programmes for 6 to 14': 'kids',
  'entertainment programs for 10 to 16': 'kids',
  'entertainment programmes for 10 to 16': 'kids',
  'cartoons puppets': 'kids',
  'music ballet dance': 'music',
  'rock pop': 'music',
  'serious music classical music': 'music',
  'folk traditional music': 'music',
  jazz: 'music',
  'musical opera': 'music',
  'arts culture without music': 'documentary',
  'social political issues economics': 'news',
  'education science factual topics': 'documentary',
  'nature animals environment': 'documentary',
  'technology natural sciences': 'documentary',
  'leisure hobbies': 'entertainment',
}

/** Lowercased, accents removed, cut into words (letters and digits), compounds joined. */
export const kindWordsOf = (text: string): string[] => {
  let joined = text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '')
    .join(' ')
  for (const [pattern, replacement] of compounds) joined = joined.replace(pattern, replacement)
  return joined === '' ? [] : joined.split(' ')
}

/** Whether the keyword's words start (or, `atEnd`, a single word ends) a run of `words`. */
const holds = (words: readonly string[], keyword: string, atEnd: boolean): boolean => {
  const parts = keyword.split(' ')
  if (parts.length === 1)
    return words.some((word) => word.startsWith(keyword) || (atEnd && word.endsWith(keyword)))
  return words.some((_, start) =>
    parts.every((part, offset) => words[start + offset]?.startsWith(part) === true),
  )
}

const kindIn = (
  words: readonly string[],
  tables: readonly KeywordTable[],
  atEnd: boolean,
): Exclude<TvProgrammeKind, 'other'> | undefined =>
  kindOrder.find((kind) =>
    tables.some((table) => (table[kind] ?? []).some((keyword) => holds(words, keyword, atEnd))),
  )

const tablesFor = (lang: string | undefined): readonly KeywordTable[] => {
  const primary = (lang ?? '').trim().toLowerCase().split(/[-_]/u)[0]
  if (primary === 'fr') return [french]
  if (primary === 'en') return [english]
  return [french, english]
}

/** The kind one category names (§29.3), or none. */
export const categoryKindOf = (
  category: TvGuideText,
): Exclude<TvProgrammeKind, 'other'> | undefined => {
  const words = kindWordsOf(category.text)
  if (words.length === 0) return undefined
  return dvbContents[words.join(' ')] ?? kindIn(words, tablesFor(category.lang), false)
}

/** A channel's own kind (§29.3): its group's words, else its name's, else `other`. */
export const channelKindOf = ({ group, name }: { group: string; name: string }): TvProgrammeKind =>
  kindIn(kindWordsOf(group), [channelWords], true) ??
  kindIn(kindWordsOf(name), [channelWords], true) ??
  'other'

/** A programme's kind (§29.3): the first of its categories that names one, else the channel's. */
export const programmeKindOf = (
  categories: readonly TvGuideText[],
  channelKind: TvProgrammeKind,
): TvProgrammeKind => {
  for (const category of categories) {
    const kind = categoryKindOf(category)
    if (kind !== undefined) return kind
  }
  return channelKind
}
