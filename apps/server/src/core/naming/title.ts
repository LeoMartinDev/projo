import type { EditionId } from '@projo/shared/api/versions'

import type { IdTags, PartInfo } from './types'

const DELIMITER_CHARS = String.raw`\s._\-()\[\]{},`
const DELIMITER = new RegExp(`[${DELIMITER_CHARS}]`, 'u')
const ONLY_DELIMITERS = new RegExp(`^[${DELIMITER_CHARS}]*$`, 'u')
const AFTER_TOKEN = `(?=[${DELIMITER_CHARS}]|$)`

const sticky = (source: string): RegExp => new RegExp(`^(?:${source})${AFTER_TOKEN}`, 'iu')

/** Tokens that never belong to a title: once one is met, everything after it is release noise. */
const STRONG_RELEASE_TOKENS = sticky(
  [
    String.raw`\d{3,4}[pi]`,
    '4k',
    'uhd',
    'ultrahd',
    String.raw`hdr(?:10\+?|10plus)?`,
    'dovi',
    'hdc',
    'hrhd(?:tv)?',
    String.raw`[xh]\.?26[45]`,
    'hevc',
    'avc',
    'av1',
    'vp9',
    'xvid(?:vd)?',
    String.raw`divx\d?`,
    String.raw`\d{1,2}bit`,
    'blu-?ray',
    'bdrip',
    'brrip',
    String.raw`bd(?:5|9|25|50)`,
    'hddvd',
    'remux',
    'web-?dl',
    'web-?rip',
    'hdtv(?:rip)?',
    'pdtv',
    'hdrip',
    'dvdrip',
    'dvdscr(?:eener)?',
    'dvdivx',
    'dsr(?:ip)?',
    'svcd',
    'telesync',
    'telecine',
    'amzn',
    'dsnp',
    'atvp',
    'hmax',
    'pcok',
    String.raw`(?:ddp?|e?ac3|aac|dts|truehd|flac|opus|mp3|atmos)[\d.]*`,
    'h-?sbs',
    'half-(?:sbs|ou)',
    'f?sbs',
    '[hf]tab',
    'h-?ou',
    'mvc',
    String.raw`read\.?nfo`,
    'nfofix',
    'vostfr',
    'vost',
    'vff',
    'vfq',
    'vfi',
    'vf2',
    'truefrench',
    'subfrench',
    'fastsub',
  ].join('|'),
)

/** Release words that can also be title words: they only cut when glued to the release region. */
const WEAK_RELEASE_TOKENS = sticky(
  [
    'proper',
    'repack',
    'rerip',
    'internal',
    'limited',
    'unrated',
    'extended',
    'retail',
    'multi(?:subs)?',
    'subs?',
    'french',
    'vf',
    'german',
    'swedish',
    'dutch',
    'ntsc',
    'xxx',
    'screener',
    'r5',
  ].join('|'),
)

const YEAR = /^(?:19|20)\d{2}(?![\dx×])/u
const DATE_AFTER = /^[.\-_ ]\d{2}[.\-_ ]\d{2}(?!\d)/u
const DATE_BEFORE = /\d{2}[.-]\d{2}[.-]$/u
/** `(1977-2019)` is a range (collection folder), not a year. */
const RANGE_AFTER = /^\s*-\s*(?:19|20)\d{2}(?!\d)/u
const RANGE_BEFORE = /(?:19|20)\d{2}\s*-\s*$/u

/** §8.1 editions recognized alone, stored as their id (the label is the web's). */
const EDITIONS: readonly (readonly [RegExp, EditionId])[] = [
  [sticky(String.raw`director'?[’]?s[\s._-]*cut`), 'directors_cut'],
  [sticky(String.raw`extended(?:[\s._-]*collector'?[’]?s)?[\s._-]*(?:cut|edition)`), 'extended'],
  [sticky(String.raw`theatrical[\s._-]*cut`), 'theatrical'],
  [sticky(String.raw`final[\s._-]*cut`), 'final_cut'],
  [sticky(String.raw`unrated[\s._-]*cut`), 'unrated'],
  [sticky('uncut'), 'uncut'],
  [sticky(String.raw`special[\s._-]*edition`), 'special_edition'],
  [sticky(String.raw`ultimate[\s._-]*edition`), 'ultimate_edition'],
  [sticky('imax'), 'imax'],
  [sticky('remastered'), 'remastered'],
]

const PART = sticky(String.raw`(cd|dvd|part|pt|disc|disk)[\s._-]?(\d{1,2}|[a-d])`)
const PART_KEYWORD_LABEL: Readonly<Record<string, string>> = {
  cd: 'CD',
  dvd: 'DVD',
  part: 'Part',
  pt: 'Pt',
  disc: 'Disc',
  disk: 'Disk',
}

const ID_TAG = /[[({]\s*(tmdbid|tmdb|imdbid|imdb|tvdbid|tvdb)\s*[-=]\s*([^\])}\s]*)\s*[\])}]/giu
const EDITION_TAG = /\{\s*edition\s*-\s*([^}]*)\}/iu
const LEADING_GROUP = /^\s*\[[^\]]*\]\s*/u
/** `[...]` after the title is release information (`[FR-EN]`, `[1080p]`), even before the year. */
const BRACKET_GROUP = /\[[^\]]*\]/gu

const positiveInt = (value: string): number | undefined => {
  if (!/^\d{1,9}$/u.test(value)) return undefined
  const n = Number(value)
  return n > 0 ? n : undefined
}

/** Removes `[tmdbid-1]`, `{imdb-tt…}`, `(tvdb=2)`… and returns what they carried. Malformed values are dropped silently. */
export const extractIdTags = (raw: string): { readonly rest: string; readonly ids?: IdTags } => {
  const found: { tmdb?: number; imdb?: string; tvdb?: number } = {}
  const rest = raw.replace(ID_TAG, (_match, rawKey: string, rawValue: string) => {
    const key = rawKey.toLowerCase()
    const value = rawValue.toLowerCase()
    if (key.startsWith('tmdb')) {
      const id = positiveInt(value)
      if (id !== undefined && found.tmdb === undefined) found.tmdb = id
    } else if (key.startsWith('tvdb')) {
      const id = positiveInt(value)
      if (id !== undefined && found.tvdb === undefined) found.tvdb = id
    } else if (/^tt\d{5,10}$/u.test(value) && found.imdb === undefined) {
      found.imdb = value
    }
    return ' '
  })
  return Object.keys(found).length > 0 ? { rest, ids: found } : { rest }
}

export const mergeIds = (
  primary: IdTags | undefined,
  secondary: IdTags | undefined,
): IdTags | undefined => {
  if (primary === undefined) return secondary
  if (secondary === undefined) return primary
  return { ...secondary, ...primary }
}

/** Lowercase, no accents, no punctuation, single spaces. Shared with matching (§9.2). */
export const normalizeTitle = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/gu, ' and ')
    .replace(/['’`]/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

const isSingleLetter = (piece: string): boolean => /^\p{L}$/u.test(piece)

/** Dots become spaces except inside acronyms (`S.W.A.T`) and before an existing space (`Mr. Robot`). */
const replaceDots = (value: string): string => {
  const pieces = value.split('.')
  return pieces.reduce((acc, piece, index) => {
    if (index === 0) return piece
    const previous = pieces[index - 1] ?? ''
    if (piece.startsWith(' ')) return `${acc}.${piece}`
    if (isSingleLetter(previous) && isSingleLetter(piece)) return `${acc}.${piece}`
    return `${acc} ${piece}`
  }, '')
}

const capitalizeWords = (value: string): string =>
  value
    .toLowerCase()
    .replace(
      /(^|[\s(\-"])(\p{L})/gu,
      (_m, before: string, letter: string) => `${before}${letter.toUpperCase()}`,
    )

const fixCasing = (value: string): string => {
  const letters = value.replace(/[^\p{L}]/gu, '')
  if (letters === '') return value
  if (letters === letters.toLowerCase()) return capitalizeWords(value)
  const isAllUpper = letters === letters.toUpperCase()
  const wordCount = value.split(' ').length
  if (isAllUpper && (wordCount > 1 || letters.length > 4)) return capitalizeWords(value)
  return value
}

const TRIM_EDGES = /^[\s._\-,([{]+|[\s._\-,([{:]+$/gu

const CLOSERS: Readonly<Record<string, string>> = { ')': '(', ']': '[', '}': '{' }

/** `GRP]` (leftover of a stripped `[GRP]`) loses its bracket, `The Office (US)` keeps its own. */
const dropUnmatchedClosers = (value: string): string => {
  const last = value.at(-1) ?? ''
  const opener = CLOSERS[last]
  if (opener === undefined || value.includes(opener)) return value
  return dropUnmatchedClosers(value.slice(0, -1).trim())
}

/** Turns a raw title slice into a display title: separators, stray brackets, casing. May return `''`. */
export const prettifyTitle = (slice: string): string => {
  const spaced = replaceDots(slice.replace(/_/gu, ' '))
    .replace(/\(\s*\)|\[\s*\]|\{\s*\}/gu, ' ')
    .replace(/\s+/gu, ' ')
    .replace(TRIM_EDGES, '')
    .replace(/\s+-$/u, '')
    .trim()
  return fixCasing(dropUnmatchedClosers(spaced))
}

type Token = { readonly index: number; readonly text: string }

const tokenize = (value: string): readonly Token[] => {
  const tokens: Token[] = []
  let start = -1
  for (let i = 0; i <= value.length; i++) {
    const char = value[i]
    const isDelimiter = char === undefined || DELIMITER.test(char)
    if (isDelimiter && start >= 0) {
      tokens.push({ index: start, text: value.slice(start, i) })
      start = -1
    } else if (!isDelimiter && start < 0) {
      start = i
    }
  }
  return tokens
}

const hasContentBefore = (value: string, index: number): boolean =>
  !ONLY_DELIMITERS.test(value.slice(0, index))

type YearHit = {
  readonly index: number
  readonly end: number
  readonly year: number
  readonly bracketed: boolean
}

const yearAt = (value: string, token: Token): YearHit | undefined => {
  const match = YEAR.exec(value.slice(token.index)) ?? undefined
  if (match === undefined || match[0].length !== token.text.length) return undefined
  const end = token.index + 4
  if (!hasContentBefore(value, token.index)) return undefined
  const after = value.slice(end)
  const before = value.slice(0, token.index)
  if (DATE_AFTER.test(after) || DATE_BEFORE.test(before)) return undefined
  if (RANGE_AFTER.test(after) || RANGE_BEFORE.test(before)) return undefined
  const charBefore = value[token.index - 1]
  const charAfter = value[end]
  const bracketed =
    (charBefore === '(' || charBefore === '[') && (charAfter === ')' || charAfter === ']')
  return { index: token.index, end, year: Number(match[0]), bracketed }
}

const matchesAt = (pattern: RegExp, value: string, index: number): RegExpExecArray | undefined =>
  pattern.exec(value.slice(index)) ?? undefined

export type TitleFragment = {
  readonly title: string
  readonly year?: number
  readonly edition?: EditionId
  /** Text of a `{edition-…}` tag, kept as written; exclusive with `edition`. */
  readonly editionName?: string
  readonly part?: PartInfo
  readonly ids?: IdTags
}

type FragmentOptions = { readonly detectParts: boolean; readonly detectYear: boolean }

const partLetterIndex = (value: string): number => 'abcd'.indexOf(value.toLowerCase()) + 1

/**
 * Parses a file stem or a folder name into a clean title (§8.1 "Release name cleanup").
 * The title ends at the earliest of: the chosen year, the first strong release token (extended backwards over
 * glued weak tokens), an accepted edition or part token, the first `[...]` group after it.
 */
export type PreparedName = {
  /** Name without id tags, `{edition-…}` tag and leading `[group]`. */
  readonly value: string
  readonly ids?: IdTags
  readonly taggedEdition?: string
}

export const prepareName = (raw: string): PreparedName => {
  const { rest: withoutIds, ids } = extractIdTags(raw.normalize('NFC'))
  const editionTag = EDITION_TAG.exec(withoutIds) ?? undefined
  const taggedEdition = editionTag?.[1]?.trim()
  const withoutEditionTag =
    editionTag === undefined ? withoutIds : withoutIds.replace(EDITION_TAG, ' ')
  const withoutGroup = withoutEditionTag.replace(LEADING_GROUP, '')
  const value = ONLY_DELIMITERS.test(withoutGroup) ? withoutEditionTag : withoutGroup
  return {
    value,
    ...(ids === undefined ? {} : { ids }),
    ...(taggedEdition === undefined || taggedEdition === '' ? {} : { taggedEdition }),
  }
}

export const parseTitleFragment = (
  raw: string | PreparedName,
  { detectParts, detectYear }: FragmentOptions = { detectParts: true, detectYear: true },
): TitleFragment => {
  const { value, ids, taggedEdition } = typeof raw === 'string' ? prepareName(raw) : raw

  const tokens = tokenize(value)
  // A strong token cuts even at the very start: `1080p.mkv` or an episode tail `.1080p.WEB` has no title.
  const firstStrong = tokens.find((t) => matchesAt(STRONG_RELEASE_TOKENS, value, t.index))
  const strongIndex = firstStrong?.index ?? value.length

  const years = detectYear
    ? tokens.flatMap((t) => {
        const hit = t.index < strongIndex ? yearAt(value, t) : undefined
        return hit === undefined ? [] : [hit]
      })
    : []
  const year = years.filter((y) => y.bracketed).at(-1) ?? years.at(-1)

  const bracketIndex =
    [...value.matchAll(BRACKET_GROUP)].find((group) => hasContentBefore(value, group.index))
      ?.index ?? value.length

  const isWeakAt = (token: Token): boolean =>
    matchesAt(WEAK_RELEASE_TOKENS, value, token.index) !== undefined

  const hardBoundary = Math.min(year?.index ?? value.length, strongIndex, bracketIndex)
  const extendOverWeak = (boundary: number): number => {
    const before = tokens.filter((t) => t.index < boundary)
    let result = boundary
    for (let i = before.length - 1; i >= 0; i--) {
      const token = before[i]
      if (token === undefined || !isWeakAt(token)) break
      if (!ONLY_DELIMITERS.test(value.slice(token.index + token.text.length, result))) break
      result = token.index
    }
    return result
  }
  const releaseBoundary = extendOverWeak(hardBoundary)

  const isAfterDash = (index: number): boolean => /[\s._]-[\s._]*$/u.test(value.slice(0, index))
  const edition: { index: number; id?: EditionId; name?: string } | undefined =
    taggedEdition !== undefined
      ? { index: value.length, name: taggedEdition }
      : tokens.flatMap((t) => {
          if (!hasContentBefore(value, t.index)) return []
          const accepted = t.index >= releaseBoundary || isAfterDash(t.index)
          if (!accepted) return []
          const found = EDITIONS.find(
            ([pattern]) => matchesAt(pattern, value, t.index) !== undefined,
          )
          return found === undefined ? [] : [{ index: t.index, id: found[1] }]
        })[0]

  const afterEdition = Math.min(releaseBoundary, edition?.index ?? value.length)

  const part = detectParts
    ? tokens.flatMap((t) => {
        if (!hasContentBefore(value, t.index)) return []
        const match = matchesAt(PART, value, t.index)
        if (match === undefined) return []
        const keyword = (match[1] ?? '').toLowerCase()
        const rawIndex = match[2] ?? ''
        if (keyword === 'dvd' && (rawIndex === '5' || rawIndex === '9')) return []
        const end = t.index + match[0].length
        // Before a year, `Part 1` belongs to the title (`Deathly Hallows Part 1 (2010)`).
        const accepted =
          t.index >= afterEdition ||
          (year === undefined &&
            end <= afterEdition &&
            ONLY_DELIMITERS.test(value.slice(end, afterEdition)))
        if (!accepted) return []
        const index = /^\d+$/u.test(rawIndex) ? Number(rawIndex) : partLetterIndex(rawIndex)
        if (index < 1) return []
        const label = `${PART_KEYWORD_LABEL[keyword] ?? keyword} ${/^\d+$/u.test(rawIndex) ? index : rawIndex.toUpperCase()}`
        return [{ index: t.index, info: { index, label } }]
      })[0]
    : undefined

  const titleEnd = Math.min(afterEdition, part?.index ?? value.length)
  const title = prettifyTitle(value.slice(0, titleEnd))

  return {
    title,
    ...(year === undefined ? {} : { year: year.year }),
    ...(edition?.id === undefined ? {} : { edition: edition.id }),
    ...(edition?.name === undefined ? {} : { editionName: edition.name }),
    ...(part === undefined ? {} : { part: part.info }),
    ...(ids === undefined ? {} : { ids }),
  }
}

/** Last-resort display text for a name that cleaned down to nothing. */
export const fallbackTitle = (raw: string): string => {
  const cleaned = prettifyTitle(raw.replace(LEADING_GROUP, ''))
  return cleaned === '' ? raw.trim() || raw : cleaned
}
