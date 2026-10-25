/** Garde-fou §8.2: seasons 200..1927 and > 2500 are invalid (`1920x1080` must not read as S1920E1080). */
export const isValidSeason = (season: number): boolean =>
  season >= 0 && !(season >= 200 && season <= 1927) && season <= 2500

export type EpisodeHit = {
  /** Where the pattern starts and ends in the analysed name. */
  readonly index: number
  readonly end: number
  readonly season?: number
  readonly episode: number
  readonly episodeEnd?: number
}

export type AbsoluteHit = {
  readonly index: number
  readonly end: number
  readonly number: number
  readonly digits: string
  readonly form: 'dash' | 'bare'
}

export type DateHit = { readonly index: number; readonly end: number; readonly airDate: string }

const NOT_WORD_BEFORE = String.raw`(?<![\p{L}\d])`
const SEP = String.raw`[\s._-]*`

/** Video codec numbers (`x264`, `x265`, `H.264`, `H.266`). */
const CODEC_NUMBER = /^26[4-6]$/u
/** An audio channel layout (`5.1`, `7.1`, `2.0`, `7.1.4`) ends right before the match. */
const CHANNEL_LAYOUT_BEFORE = /(?<!\d)\d\.$/u
/** `H.265`, `x.264`: a lone codec letter, then delimiters, right before the match (not `Bleach 265`). */
const CODEC_LETTER_BEFORE = /(?<![\p{L}\d])[hx][\s._]*$/iu

/** `DDP5.1x265`, `AAC2.0x264`: a channel layout glued to the codec, not season 1 episode 265 (§8.2). */
const isChannelLayoutThenCodec = (value: string, index: number, episodeDigits: string): boolean =>
  CODEC_NUMBER.test(episodeDigits) && CHANNEL_LAYOUT_BEFORE.test(value.slice(0, index))

const EXPLICIT_PATTERNS: readonly RegExp[] = [
  // S01E02, S01.E02, S01xE02, S01 E02, s1e2
  new RegExp(String.raw`${NOT_WORD_BEFORE}s(\d{1,4})${SEP}x?${SEP}e(\d{1,4})(?!\d)`, 'giu'),
  // 1x02
  new RegExp(String.raw`${NOT_WORD_BEFORE}(\d{1,2})x(\d{2,3})(?!\d)`, 'giu'),
  // se1.ep2
  new RegExp(String.raw`${NOT_WORD_BEFORE}se(\d{1,4})${SEP}ep(\d{1,4})(?!\d)`, 'giu'),
  // season1.episode2, Season 1 Episode 2
  new RegExp(
    String.raw`${NOT_WORD_BEFORE}(?:season|saison)${SEP}(\d{1,4})${SEP}(?:episode|épisode)${SEP}(\d{1,4})(?!\d)`,
    'giu',
  ),
]

// End number is rejected when followed by digits, `p` or `i` (`S09E14-1080p`).
const MULTI_AFTER_S = /^(?:[\s._]*-[\s._]*s\d{1,4}e|-?e|-)(\d{1,4})(?![\dpi])/iu
const MULTI_AFTER_X = /^-(?:\d{1,2}x)?(\d{2,3})(?![\dpi])/iu
const MULTI_AFTER_KEYWORD =
  /^[\s._]*-[\s._]*(?:(?:episode|épisode|ep)[\s._-]*)?(\d{1,4})(?![\dpi])/iu

const extendMulti = (
  value: string,
  end: number,
  start: number,
  pattern: RegExp,
  repeat: boolean,
): { end: number; last?: number } => {
  let position = end
  let last: number | undefined
  for (;;) {
    const match = pattern.exec(value.slice(position)) ?? undefined
    const digits = match?.[1]
    if (match === undefined || digits === undefined) break
    const n = Number(digits)
    if (n < (last ?? start)) break
    if (n > start) last = n
    position += match[0].length
    if (!repeat) break
  }
  return last === undefined ? { end: position } : { end: position, last }
}

const toHit = (
  index: number,
  end: number,
  season: number | undefined,
  episode: number,
  episodeEnd: number | undefined,
): EpisodeHit => ({
  index,
  end,
  ...(season === undefined ? {} : { season }),
  episode,
  ...(episodeEnd === undefined ? {} : { episodeEnd }),
})

/** Patterns that identify an episode from the file name alone (§8.2 "Motifs", without folder context). */
export const findExplicitEpisode = (value: string): EpisodeHit | undefined => {
  const hits = EXPLICIT_PATTERNS.flatMap((pattern, patternIndex) =>
    [...value.matchAll(pattern)].flatMap((match) => {
      const season = Number(match[1])
      const episode = Number(match[2])
      if (!isValidSeason(season)) return []
      if (patternIndex === 1 && isChannelLayoutThenCodec(value, match.index, match[2] ?? ''))
        return []
      const end = match.index + match[0].length
      const multi = extendMulti(
        value,
        end,
        episode,
        patternIndex === 1 ? MULTI_AFTER_X : MULTI_AFTER_S,
        patternIndex !== 1,
      )
      return [toHit(match.index, multi.end, season, episode, multi.last)]
    }),
  )
  return hits.reduce<EpisodeHit | undefined>(
    (best, hit) => (best === undefined || hit.index < best.index ? hit : best),
    undefined,
  )
}

const EPISODE_KEYWORD = new RegExp(
  String.raw`${NOT_WORD_BEFORE}(?:episode|épisode|ep)${SEP}(\d{1,4})(?!\d)`,
  'iu',
)

/** `Episode 02`, `Episode 16-17` (needs folder context). */
export const findEpisodeKeyword = (value: string): EpisodeHit | undefined => {
  const match = EPISODE_KEYWORD.exec(value) ?? undefined
  if (match === undefined) return undefined
  const episode = Number(match[1])
  const multi = extendMulti(
    value,
    match.index + match[0].length,
    episode,
    MULTI_AFTER_KEYWORD,
    false,
  )
  return toHit(match.index, multi.end, undefined, episode, multi.last)
}

const LEADING_NUMBER = /^(\d{1,3})(?=$|[\s._]*-|\.|[\s_]+\D)/u

/** `02 - Titre`, `02.Titre`, `02` (needs a season folder). */
export const findLeadingNumber = (value: string): EpisodeHit | undefined => {
  const match = LEADING_NUMBER.exec(value.trimStart()) ?? undefined
  if (match === undefined) return undefined
  const offset = value.length - value.trimStart().length
  return toHit(offset, offset + match[0].length, undefined, Number(match[1]), undefined)
}

const SEASON_DOT_EPISODE = /^(\d{1,2})\.(\d{2,3})(?=[\s_-]|$)/u

/** `01.02 Titre` = season 1 episode 2 (needs a series folder). */
export const findSeasonDotEpisode = (value: string): EpisodeHit | undefined => {
  const match = SEASON_DOT_EPISODE.exec(value) ?? undefined
  if (match === undefined) return undefined
  const episode = Number(match[2])
  if (episode < 1) return undefined
  return toHit(0, match[0].length, Number(match[1]), episode, undefined)
}

const ABSOLUTE_AFTER = String.raw`(?:v\d)?(?=[\s._\-()\[\]]|$)`
const ABSOLUTE_DASH = new RegExp(String.raw`[\s._]+-[\s._]+(\d{1,4})${ABSOLUTE_AFTER}`, 'gu')
const ABSOLUTE_BARE = new RegExp(String.raw`[\s._]+(\d{3,4})${ABSOLUTE_AFTER}`, 'gu')
const RESOLUTION_NUMBERS = new Set(['480', '576', '720', '1080', '2160'])
const YEAR_LIKE = /^(?:19|20)\d{2}$/u

/**
 * `Name - 101`, `[Group] Name - 12 [1080p]` (group already stripped), `Name 101`.
 * The bare form needs 3-4 digits so that sequels (`Toy Story 3`, `Apollo 13`) are not read as episodes.
 */
export const findAbsoluteNumber = (value: string): AbsoluteHit | undefined => {
  const find = (pattern: RegExp, form: AbsoluteHit['form']): AbsoluteHit | undefined => {
    for (const match of value.matchAll(pattern)) {
      const digits = match[1] ?? ''
      if (value.slice(0, match.index).trim() === '') continue
      if (YEAR_LIKE.test(digits)) continue
      if (form === 'bare' && RESOLUTION_NUMBERS.has(digits)) continue
      if (CODEC_NUMBER.test(digits) && CODEC_LETTER_BEFORE.test(value.slice(0, match.index)))
        continue
      return {
        index: match.index,
        end: match.index + match[0].length,
        number: Number(digits),
        digits,
        form,
      }
    }
    return undefined
  }
  return find(ABSOLUTE_DASH, 'dash') ?? find(ABSOLUTE_BARE, 'bare')
}

const DATE_YMD = /(?<!\d)((?:19|20)\d{2})[.\-_ ](\d{2})[.\-_ ](\d{2})(?!\d)/u
const DATE_DMY = /(?<!\d)(\d{2})[.-](\d{2})[.-]((?:19|20)\d{2})(?!\d)/u

const isoDate = (year: string, month: string, day: string): string | undefined => {
  const m = Number(month)
  const d = Number(day)
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined
  return `${year}-${month}-${day}`
}

/** `2017.04.20`, `2017-04-20`, `20.04.2017`. */
export const findAirDate = (value: string): DateHit | undefined => {
  const ymd = DATE_YMD.exec(value) ?? undefined
  if (ymd !== undefined) {
    const airDate = isoDate(ymd[1] ?? '', ymd[2] ?? '', ymd[3] ?? '')
    if (airDate !== undefined) return { index: ymd.index, end: ymd.index + ymd[0].length, airDate }
  }
  const dmy = DATE_DMY.exec(value) ?? undefined
  if (dmy !== undefined) {
    const airDate = isoDate(dmy[3] ?? '', dmy[2] ?? '', dmy[1] ?? '')
    if (airDate !== undefined) return { index: dmy.index, end: dmy.index + dmy[0].length, airDate }
  }
  return undefined
}

const SEASON_KEYWORDS = [
  'season',
  'saison',
  'sæson',
  'säsong',
  'seizoen',
  'seasong',
  'sezon',
  'sezona',
  'sezóna',
  'sezonul',
  'staffel',
  'series',
  'stagione',
  'temporada',
  'kausi',
  'évad',
  'сезон',
  'сезона',
  '시즌',
  'シーズン',
  's',
].join('|')

const SEASON_KEYWORD_FIRST = new RegExp(
  String.raw`^(?:${SEASON_KEYWORDS})[\s._-]*(\d{1,4})(?:(?:[\s._]*-[\s._]*|[\s._]+)(.*))?$`,
  'iu',
)
const SEASON_NUMBER_FIRST = new RegExp(
  String.raw`^(\d{1,4})(?:st|nd|rd|th|\.)?[\s._-]*(?:${SEASON_KEYWORDS})$`,
  'iu',
)
const SEASON_NUMERIC = /^\d{1,3}$/u
const SPECIALS = /^(?:specials?|spéciaux)$/iu

export type SeasonFolder = { readonly season: number; readonly title?: string }

/** `Season 01`, `Saison 2 - La fuite`, `S01`, `Staffel 1`, `01`, `Specials`… (§8.2 "Dossier saison"). */
export const parseSeasonFolder = (rawName: string): SeasonFolder | undefined => {
  const name = rawName.normalize('NFC').trim()
  if (SPECIALS.test(name)) return { season: 0 }
  const keywordFirst = SEASON_KEYWORD_FIRST.exec(name) ?? undefined
  const numberFirst = SEASON_NUMBER_FIRST.exec(name) ?? undefined
  const digits =
    keywordFirst?.[1] ?? numberFirst?.[1] ?? (SEASON_NUMERIC.test(name) ? name : undefined)
  if (digits === undefined) return undefined
  const season = Number(digits)
  if (!isValidSeason(season)) return undefined
  const title = keywordFirst?.[2]?.trim()
  return title === undefined || title === '' ? { season } : { season, title }
}
