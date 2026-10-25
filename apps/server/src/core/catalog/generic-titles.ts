/**
 * Generic names (§6.3): "Episode 7", "Saison 2", "Specials", "Chapter 01" say nothing the number
 * does not. They are not stored nor sent as text: the item (or chapter) has no title of its own
 * and the clients label it from its number in the interface language. Pure, no I/O.
 */

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

/** `<word> [#|n°] <number>`, case and spacing insensitive. */
const numbered = (words: readonly string[]) =>
  new RegExp(`^(?:${words.map(escape).join('|')})\\s*(?:#|n°|no\\.?)?\\s*(\\d{1,5})$`, 'iu')

const patterns: Record<NumberedKind, RegExp> = {
  episode: numbered(EPISODE_WORDS),
  season: numbered(SEASON_WORDS),
  // Muxers also name chapters by their bare number ("01").
  chapter: new RegExp(`${numbered(CHAPTER_WORDS).source}|^(\\d{1,3})$`, 'iu'),
}
const specials = new RegExp(`^(?:${SPECIALS_WORDS.map(escape).join('|')})$`, 'iu')

const clean = (title: string) => title.normalize('NFC').trim().replace(/\s+/gu, ' ')

/**
 * The number a generic name spells ("Saison 02" → 2, "Specials" → 0 for a season), `undefined`
 * for a real name ("Book One: Water", "Pilot", "Chapter 9: The Marshal").
 */
export const genericTitleNumber = (kind: NumberedKind, title: string): number | undefined => {
  const value = clean(title)
  if (kind === 'season' && specials.test(value)) return 0
  const match = patterns[kind].exec(value)
  const digits = match?.[1] ?? match?.[2]
  return digits === undefined ? undefined : Number(digits)
}

/** A chapter name worth showing; the generic ones ("Chapter 01", "Chapitre 3", "07") are dropped. */
export const chapterTitle = (title: string | undefined): string | undefined =>
  title === undefined || clean(title) === '' || genericTitleNumber('chapter', title) !== undefined
    ? undefined
    : title

/**
 * An item's own title: absent when empty, or for a season or an episode whose name is the generic
 * one of its own number ("Episode 7" on episode 7; "Episode 1050" on S21E5 is kept, it says more).
 */
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
