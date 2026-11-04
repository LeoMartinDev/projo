export type NumberedKind = 'season' | 'episode' | 'chapter'

const EPISODE_WORDS = [
  'episode',
  'épisode',
  'episodio',
  'epizoda',
  'epizod',
  'folge',
  'aflevering',
  'odcinek',
  'avsnitt',
  'afsnit',
  'jakso',
  'ep',
  'ep.',
]
const SEASON_WORDS = [
  'season',
  'saison',
  'series',
  'staffel',
  'temporada',
  'stagione',
  'seizoen',
  'sezon',
  'säsong',
  'sæson',
  'kausi',
]
const SPECIALS_WORDS = [
  'special',
  'specials',
  'spéciaux',
  'épisodes spéciaux',
  'épisode spécial',
  'episodes speciaux',
  'especiales',
  'speciali',
  'extras',
]
const CHAPTER_WORDS = [
  'chapter',
  'chapitre',
  'kapitel',
  'capítulo',
  'capitulo',
  'capitolo',
  'hoofdstuk',
  'rozdział',
  'chap.',
  'ch.',
]

const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')

const numbered = (words: readonly string[]) =>
  new RegExp(`^(?:${words.map(escape).join('|')})\\s*(?:#|n°|no\\.?)?\\s*(\\d{1,5})$`, 'iu')

const patterns: Record<NumberedKind, RegExp> = {
  episode: numbered(EPISODE_WORDS),
  season: numbered(SEASON_WORDS),
  chapter: new RegExp(`${numbered(CHAPTER_WORDS).source}|^(\\d{1,3})$`, 'iu'),
}
const specials = new RegExp(`^(?:${SPECIALS_WORDS.map(escape).join('|')})$`, 'iu')

const clean = (title: string) => title.normalize('NFC').trim().replace(/\s+/gu, ' ')

export const genericTitleNumber = (kind: NumberedKind, title: string): number | undefined => {
  const value = clean(title)
  if (kind === 'season' && specials.test(value)) return 0
  const match = patterns[kind].exec(value)
  const digits = match?.[1] ?? match?.[2]
  return digits === undefined ? undefined : Number(digits)
}

export const chapterTitle = (title: string | undefined): string | undefined =>
  title === undefined || clean(title) === '' || genericTitleNumber('chapter', title) !== undefined
    ? undefined
    : title

export const ownTitle = (item: {
  kind: 'movie' | 'series' | 'season' | 'episode'
  title: string | undefined
  seasonNumber?: number | undefined
  episodeNumber?: number | undefined
}): string | undefined => {
  const { kind, title } = item
  if (title === undefined || clean(title) === '') return undefined
  const number =
    kind === 'season' ? item.seasonNumber : kind === 'episode' ? item.episodeNumber : undefined
  if (number === undefined || (kind !== 'season' && kind !== 'episode')) return title
  return genericTitleNumber(kind, title) === number ? undefined : title
}
