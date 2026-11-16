import type { EditionId } from '@projo/shared/api/versions'

import type { IdTags, PartInfo } from './types'

const DELIMITER_CHARS = String.raw`\s._\-()\[\]{},`
const DELIMITER = new RegExp(`[${DELIMITER_CHARS}]`, 'u')
const ONLY_DELIMITERS = new RegExp(`^[${DELIMITER_CHARS}]*$`, 'u')
const AFTER_TOKEN = `(?=[${DELIMITER_CHARS}]|$)`

const sticky = (source: string): RegExp => new RegExp(`^(?:${source})${AFTER_TOKEN}`, 'iu')

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
    'bdremux',
    'hdlight',
    String.raw`\d+klight`,
    'mhd',
    'sdr',
    'dv',
    'dolby',
    'tvrip',
    'hdcam',
    'camrip',
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
    'nf',
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
    'vosta',
    'vost',
    String.raw`multi-?french`,
    'vff',
    'vfq',
    'vfi',
    'vf2',
    'truefrench',
    'subfrench',
    'fastsub',
  ].join('|'),
)

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
    'vo',
    'fr',
    'f?hd',
    'sd',
    'german',
    'swedish',
    'dutch',
    'ntsc',
    'xxx',
    'screener',
    'r5',
    String.raw`\d{1,4}[\s._-]*(?:eps?|[eé]pisodes?)`,
  ].join('|'),
)

/**
 * Complete-set markers (§8.1): never cut, since a title can end with one (`Mission Complete`).
 * Ending the title, they give `withoutMarkers`, which the matching tries only after the full title.
 */
const COMPLETE_SET_MARKERS = sticky(
  [String.raw`int[eé]grale?`, String.raw`compl[eèé]te?`].join('|'),
)

const YEAR = /^(?:19|20)\d{2}(?![\dx×])/u
const DATE_AFTER = /^[.\-_ ]\d{2}[.\-_ ]\d{2}(?!\d)/u
const DATE_BEFORE = /\d{2}[.-]\d{2}[.-]$/u
const RANGE_AFTER = /^\s*[-–—]\s*(?:19|20)\d{2}(?!\d)/u
const RANGE_BEFORE = /(?:19|20)\d{2}\s*[-–—]\s*$/u
const YEAR_RANGE = /^((?:19|20)\d{2})\s*[-–—]\s*(?:19|20)\d{2}(?![\dx×])/u

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
const BRACKET_GROUP = /\[[^\]]*\]/gu

const positiveInt = (value: string): number | undefined => {
  if (!/^\d{1,9}$/u.test(value)) return undefined
  const n = Number(value)
  return n > 0 ? n : undefined
}

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

const TRIM_EDGES = /^[\s._\-,]+|[\s._\-,([{:]+$/gu

const OPENERS: Readonly<Record<string, string>> = { '(': ')', '[': ']', '{': '}' }
const CLOSERS: Readonly<Record<string, string>> = { ')': '(', ']': '[', '}': '{' }

const dropUnmatchedOpeners = (value: string): string => {
  const closer = OPENERS[value[0] ?? '']
  if (closer === undefined || value.includes(closer)) return value
  return dropUnmatchedOpeners(value.slice(1).replace(/^[\s._\-,]+/u, ''))
}

const dropUnmatchedClosers = (value: string): string => {
  const last = value.at(-1) ?? ''
  const opener = CLOSERS[last]
  if (opener === undefined || value.includes(opener)) return value
  return dropUnmatchedClosers(value.slice(0, -1).trim())
}

const cleanTitle = (slice: string): string => {
  const spaced = replaceDots(slice.replace(/_/gu, ' '))
    .replace(/\(\s*\)|\[\s*\]|\{\s*\}/gu, ' ')
    .replace(/\s+/gu, ' ')
    .replace(TRIM_EDGES, '')
    .replace(/\s+-$/u, '')
    .trim()
  return dropUnmatchedClosers(dropUnmatchedOpeners(spaced))
}

export const prettifyTitle = (slice: string): string => fixCasing(cleanTitle(slice))

/** A shorter form of a title, cased like the title (`SHOW INTEGRALE` → `Show`, not `SHOW`). */
const prettifyShorter = (slice: string, full: string): string => {
  const cleanFull = cleanTitle(full)
  const short = cleanTitle(slice)
  return fixCasing(cleanFull) === cleanFull ? short : capitalizeWords(short)
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

type RangeHit = { readonly index: number; readonly start: number }

const rangeAt = (value: string, token: Token): RangeHit | undefined => {
  const match = YEAR_RANGE.exec(value.slice(token.index)) ?? undefined
  if (match === undefined || !hasContentBefore(value, token.index)) return undefined
  return { index: token.index, start: Number(match[1]) }
}

const matchesAt = (pattern: RegExp, value: string, index: number): RegExpExecArray | undefined =>
  pattern.exec(value.slice(index)) ?? undefined

export const releaseTagIndex = (value: string): number =>
  tokenize(value).find((t) => matchesAt(STRONG_RELEASE_TOKENS, value, t.index))?.index ??
  value.length

export type TitleFragment = {
  readonly title: string
  readonly year?: number
  /** First year of a range of years (`2015-2018`): never a movie's year, a show's first year. */
  readonly rangeStart?: number
  /** The title without the complete-set markers ending it (§8.1); absent when none ends it. */
  readonly withoutMarkers?: string
  readonly edition?: EditionId
  readonly editionName?: string
  readonly part?: PartInfo
  readonly ids?: IdTags
}

type FragmentOptions = { readonly detectParts: boolean; readonly detectYear: boolean }

const partLetterIndex = (value: string): number => 'abcd'.indexOf(value.toLowerCase()) + 1

export type PreparedName = {
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
  const firstStrong = tokens.find((t) => matchesAt(STRONG_RELEASE_TOKENS, value, t.index))
  const strongIndex = firstStrong?.index ?? value.length

  const years = detectYear
    ? tokens.flatMap((t) => {
        const hit = t.index < strongIndex ? yearAt(value, t) : undefined
        return hit === undefined ? [] : [hit]
      })
    : []
  const year = years.filter((y) => y.bracketed).at(-1) ?? years.at(-1)
  const range = detectYear
    ? tokens.flatMap((t) => {
        const hit = t.index < strongIndex ? rangeAt(value, t) : undefined
        return hit === undefined ? [] : [hit]
      })[0]
    : undefined

  const bracketIndex =
    [...value.matchAll(BRACKET_GROUP)].find((group) => hasContentBefore(value, group.index))
      ?.index ?? value.length

  const endsRightBefore = (pattern: RegExp, token: Token, end: number): boolean => {
    const match = matchesAt(pattern, value, token.index)
    if (match === undefined) return false
    const tokenEnd = token.index + match[0].length
    return tokenEnd <= end && ONLY_DELIMITERS.test(value.slice(tokenEnd, end))
  }
  // A word can span two tokens (`131 EP`), hence the last two tokens before `end`.
  const startBefore = (patterns: readonly RegExp[], end: number): number | undefined =>
    tokens
      .filter((t) => t.index < end)
      .slice(-2)
      .reverse()
      .find((t) => patterns.some((pattern) => endsRightBefore(pattern, t, end)))?.index
  const extendOver =
    (patterns: readonly RegExp[]) =>
    (boundary: number): number => {
      const start = startBefore(patterns, boundary)
      return start === undefined ? boundary : extendOver(patterns)(start)
    }

  const hardBoundary = Math.min(
    year?.index ?? value.length,
    range?.index ?? value.length,
    strongIndex,
    bracketIndex,
  )
  const releaseBoundary = extendOver([WEAK_RELEASE_TOKENS])(hardBoundary)

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
  const endsWithMarker = startBefore([COMPLETE_SET_MARKERS], titleEnd) !== undefined
  const withoutMarkers = endsWithMarker
    ? prettifyShorter(
        value.slice(0, extendOver([COMPLETE_SET_MARKERS, WEAK_RELEASE_TOKENS])(titleEnd)),
        value.slice(0, titleEnd),
      )
    : ''

  return {
    title,
    ...(year === undefined ? {} : { year: year.year }),
    ...(range === undefined ? {} : { rangeStart: range.start }),
    ...(withoutMarkers === '' ? {} : { withoutMarkers }),
    ...(edition?.id === undefined ? {} : { edition: edition.id }),
    ...(edition?.name === undefined ? {} : { editionName: edition.name }),
    ...(part === undefined ? {} : { part: part.info }),
    ...(ids === undefined ? {} : { ids }),
  }
}

export const fallbackTitle = (raw: string): string => {
  const cleaned = prettifyTitle(raw.replace(LEADING_GROUP, ''))
  return cleaned === '' ? raw.trim() || raw : cleaned
}
