import {
  type AbsoluteHit,
  type DateHit,
  type EpisodeHit,
  findAbsoluteNumber,
  findAirDate,
  findEpisodeKeyword,
  findExplicitEpisode,
  findLeadingNumber,
  findSeasonDotEpisode,
  parseSeasonFolder,
  type SeasonFolder,
} from './episode'
import { fileName, parentSegments, stemOf } from './path'
import {
  fallbackTitle,
  mergeIds,
  normalizeTitle,
  type PreparedName,
  parseTitleFragment,
  prepareName,
  type TitleFragment,
} from './title'
import type {
  IdTags,
  LibraryHint,
  MediaPathAnalysis,
  MediaPathInput,
  NamingReviewReason,
  ParsedName,
} from './types'

type Context = {
  readonly hint: LibraryHint
  readonly stem: string
  readonly file: PreparedName
  readonly parents: readonly string[]
  /** Nearest season folder above the file, with the folder right above it (the series folder) if any. */
  readonly seasonFolder?: SeasonFolder
  readonly seriesFolder?: string
}

const buildContext = ({ relativePath, hint }: MediaPathInput): Context => {
  const normalized = relativePath.normalize('NFC')
  const stem = stemOf(fileName(normalized))
  const parents = parentSegments(normalized)
  const seasonIndex = parents.findLastIndex((segment) => parseSeasonFolder(segment) !== undefined)
  const seasonFolder = seasonIndex >= 0 ? parseSeasonFolder(parents[seasonIndex] ?? '') : undefined
  const seriesFolder = seasonIndex > 0 ? parents[seasonIndex - 1] : undefined
  return {
    hint,
    stem,
    file: prepareName(stem),
    parents,
    ...(seasonFolder === undefined ? {} : { seasonFolder }),
    ...(seriesFolder === undefined ? {} : { seriesFolder }),
  }
}

const parentFolder = (ctx: Context): string | undefined => ctx.parents.at(-1)

const sameTitle = (a: string, b: string): boolean =>
  a !== '' && normalizeTitle(a) === normalizeTitle(b)

const withIds = (ids: IdTags | undefined): { ids?: IdTags } => (ids === undefined ? {} : { ids })

const compact = (parsed: { [K in keyof ParsedName]: ParsedName[K] | undefined }): ParsedName =>
  Object.fromEntries(
    Object.entries(parsed).filter(([, value]) => value !== undefined && value !== ''),
  ) as ParsedName

const result = (
  classification: MediaPathAnalysis['classification'],
  parsed: ParsedName,
  displayTitle: string,
  reviewReason: NamingReviewReason | undefined,
): MediaPathAnalysis => ({
  classification,
  parsed,
  displayTitle,
  ...(reviewReason === undefined ? {} : { reviewReason }),
})

type SeriesIdentity = { readonly series?: string; readonly year?: number; readonly ids?: IdTags }

/**
 * Series name: a structural folder (above a season folder, carrying an id tag, or matching the prefix) wins,
 * otherwise what precedes the episode pattern in the file name (§8.2 "Flat episode at the root").
 */
const resolveSeries = (ctx: Context, prefix: string): SeriesIdentity => {
  const fromPrefix = parseTitleFragment({ value: prefix }, { detectParts: false, detectYear: true })
  const folderName = ctx.seasonFolder === undefined ? parentFolder(ctx) : ctx.seriesFolder
  const fromFolder =
    folderName === undefined
      ? undefined
      : parseTitleFragment(folderName, { detectParts: false, detectYear: true })
  const folderIsStructural =
    fromFolder !== undefined &&
    fromFolder.title !== '' &&
    (ctx.seasonFolder !== undefined ||
      fromPrefix.title === '' ||
      fromFolder.ids !== undefined ||
      sameTitle(fromFolder.title, fromPrefix.title))
  const chosen: TitleFragment | undefined = folderIsStructural
    ? fromFolder
    : fromPrefix.title === ''
      ? undefined
      : fromPrefix
  const other = chosen === fromFolder ? fromPrefix : fromFolder
  const year =
    chosen?.year ??
    (chosen !== undefined && other !== undefined && sameTitle(chosen.title, other.title)
      ? other.year
      : undefined)
  const ids = mergeIds(ctx.file.ids, folderIsStructural ? fromFolder?.ids : undefined)
  return {
    ...(chosen === undefined ? {} : { series: chosen.title }),
    ...(year === undefined ? {} : { year }),
    ...withIds(ids),
  }
}

/** Sonarr anime naming repeats the absolute number after the pattern: `S01E12 - 012 - Title`. */
const LEADING_ABSOLUTE = /^[\s._-]*\d{1,4}[\s._]*-(?=[\s._]*\S)/u

const episodeTitleFrom = (rest: string): string | undefined => {
  const value = rest.replace(LEADING_ABSOLUTE, ' ')
  const title = parseTitleFragment({ value }, { detectParts: false, detectYear: false }).title
  return title === '' || /^\d+$/u.test(title) ? undefined : title
}

type EpisodeNumbers =
  | { readonly kind: 'standard'; readonly hit: EpisodeHit }
  | { readonly kind: 'absolute'; readonly hit: AbsoluteHit }
  | { readonly kind: 'date'; readonly hit: DateHit }
  | { readonly kind: 'none' }

const episodeResult = (
  ctx: Context,
  numbers: EpisodeNumbers,
  reviewReason: NamingReviewReason | undefined,
): MediaPathAnalysis => {
  const value = ctx.file.value
  const hit = numbers.kind === 'none' ? undefined : numbers.hit
  const prefix = hit === undefined ? '' : value.slice(0, hit.index)
  const series = resolveSeries(ctx, hit === undefined ? value : prefix)
  const episodeTitle = hit === undefined ? undefined : episodeTitleFrom(value.slice(hit.end))
  const folderSeason = ctx.seasonFolder?.season
  const parsed = compact({
    series: series.series,
    year: series.year,
    ...(numbers.kind === 'standard'
      ? {
          season: numbers.hit.season ?? folderSeason ?? 1,
          episode: numbers.hit.episode,
          episodeEnd: numbers.hit.episodeEnd,
        }
      : { season: folderSeason }),
    ...(numbers.kind === 'absolute' ? { absoluteEpisode: numbers.hit.number } : {}),
    ...(numbers.kind === 'date' ? { airDate: numbers.hit.airDate } : {}),
    episodeTitle,
    editionName: ctx.file.taggedEdition,
    ids: series.ids,
  })
  const displayTitle = parsed.series ?? episodeTitle ?? fallbackTitle(ctx.stem)
  return result(
    'episode',
    parsed,
    displayTitle,
    numbers.kind === 'date' ? 'date_based' : reviewReason,
  )
}

const looksLikeMovieFolder = (fragment: TitleFragment): boolean =>
  fragment.title !== '' && (fragment.year !== undefined || fragment.ids !== undefined)

/** Movie title and year, preferring a `Title (Year)` parent folder over the file name (§8.1 "Dossier par film"). */
const movieParsed = (ctx: Context): ParsedName => {
  const file = parseTitleFragment(ctx.file)
  const folderName = parentFolder(ctx)
  const folder =
    folderName === undefined
      ? undefined
      : parseTitleFragment(folderName, { detectParts: false, detectYear: true })
  const yearsDisagree =
    file.year !== undefined && folder?.year !== undefined && file.year !== folder.year
  const useFolder =
    folder !== undefined &&
    !yearsDisagree &&
    (looksLikeMovieFolder(folder) || (file.title === '' && folder.title !== ''))
  const title = useFolder ? folder.title : file.title
  const year = useFolder
    ? (folder.year ?? file.year)
    : (file.year ??
      (folder !== undefined && sameTitle(folder.title, file.title) ? folder.year : undefined))
  const editionFrom =
    file.edition === undefined && file.editionName === undefined && useFolder ? folder : file
  return compact({
    title,
    year,
    edition: editionFrom.edition,
    editionName: editionFrom.editionName,
    part: file.part,
    ids: mergeIds(
      file.ids,
      folder !== undefined && looksLikeMovieFolder(folder) && !yearsDisagree
        ? folder.ids
        : undefined,
    ),
  })
}

const movieResult = (ctx: Context, forced: boolean): MediaPathAnalysis => {
  const parsed = movieParsed(ctx)
  if (parsed.title === undefined && !forced) {
    return result('unknown', parsed, fallbackTitle(ctx.stem), 'classification_ambiguous')
  }
  return result('movie', parsed, parsed.title ?? fallbackTitle(ctx.stem), undefined)
}

const unknownResult = (ctx: Context, extra: ParsedName): MediaPathAnalysis => {
  const parsed = compact({ ...movieParsed(ctx), ...extra })
  return result(
    'unknown',
    parsed,
    parsed.title ?? fallbackTitle(ctx.stem),
    'classification_ambiguous',
  )
}

/** Episode numbers found with the help of a season folder: `Episode 02`, `01.02 Titre`, `02 - Titre`, `Name - 05`. */
const numbersUnderSeasonFolder = (ctx: Context, season: number): EpisodeNumbers => {
  const value = ctx.file.value
  const keyword = findEpisodeKeyword(value)
  if (keyword !== undefined) return { kind: 'standard', hit: keyword }
  const seasonDot = findSeasonDotEpisode(value)
  if (seasonDot !== undefined && seasonDot.season === season)
    return { kind: 'standard', hit: seasonDot }
  const leading = findLeadingNumber(value)
  if (leading !== undefined) return { kind: 'standard', hit: leading }
  const absolute = findAbsoluteNumber(value)
  if (absolute !== undefined) {
    return {
      kind: 'standard',
      hit: { index: absolute.index, end: absolute.end, episode: absolute.number },
    }
  }
  const date = findAirDate(value)
  return date === undefined ? { kind: 'none' } : { kind: 'date', hit: date }
}

const parentFolderTitle = (ctx: Context): string => {
  const folderName = parentFolder(ctx)
  return folderName === undefined
    ? ''
    : normalizeTitle(parseTitleFragment(folderName, { detectParts: false, detectYear: true }).title)
}

/** `Fahrenheit 451/Fahrenheit 451.mkv`: the number belongs to the title, not to an episode. */
const isNumberPartOfFolderTitle = (ctx: Context, hit: AbsoluteHit): boolean => {
  const words = parentFolderTitle(ctx).split(' ')
  return words.includes(hit.digits) || words.includes(String(hit.number))
}

/** Absolute numbering counts as an episode only inside a folder named like the series. */
const isInSeriesFolder = (ctx: Context, hit: AbsoluteHit): boolean => {
  const folder = parentFolderTitle(ctx)
  const prefix = normalizeTitle(
    parseTitleFragment({ value: ctx.file.value.slice(0, hit.index) }).title,
  )
  if (folder === '' || prefix === '') return false
  return folder.startsWith(prefix) || prefix.startsWith(folder)
}

/**
 * Classifies and parses a file path relative to its library root (§7.2, §8). Total: always returns a value,
 * `unknown` with `classification_ambiguous` when nothing fits.
 */
export const analyzeMediaPath = (input: MediaPathInput): MediaPathAnalysis => {
  const ctx = buildContext(input)
  const value = ctx.file.value

  const explicit = findExplicitEpisode(value)
  if (explicit !== undefined) {
    return episodeResult(
      ctx,
      { kind: 'standard', hit: explicit },
      ctx.hint === 'movies' ? 'hint_conflict' : undefined,
    )
  }

  if (ctx.hint === 'movies') return movieResult(ctx, true)

  if (ctx.seasonFolder !== undefined) {
    return episodeResult(ctx, numbersUnderSeasonFolder(ctx, ctx.seasonFolder.season), undefined)
  }

  const seasonDot =
    ctx.parents.length > 0 || ctx.hint === 'series' ? findSeasonDotEpisode(value) : undefined
  if (seasonDot !== undefined)
    return episodeResult(ctx, { kind: 'standard', hit: seasonDot }, undefined)

  const absolute = findAbsoluteNumber(value)
  const noYearInName = parseTitleFragment(ctx.file).year === undefined
  const usableAbsolute =
    absolute !== undefined &&
    (absolute.form === 'dash' || noYearInName) &&
    !isNumberPartOfFolderTitle(ctx, absolute)
      ? absolute
      : undefined
  const date = findAirDate(value)

  if (ctx.hint === 'series') {
    const keyword = findEpisodeKeyword(value)
    if (keyword !== undefined)
      return episodeResult(ctx, { kind: 'standard', hit: keyword }, undefined)
    if (usableAbsolute !== undefined)
      return episodeResult(ctx, { kind: 'absolute', hit: usableAbsolute }, undefined)
    if (date !== undefined) return episodeResult(ctx, { kind: 'date', hit: date }, undefined)
    const leading = findLeadingNumber(value)
    if (leading !== undefined)
      return episodeResult(ctx, { kind: 'standard', hit: leading }, undefined)
    return episodeResult(ctx, { kind: 'none' }, 'hint_conflict')
  }

  if (usableAbsolute !== undefined) {
    if (isInSeriesFolder(ctx, usableAbsolute))
      return episodeResult(ctx, { kind: 'absolute', hit: usableAbsolute }, undefined)
    const series = parseTitleFragment({ value: value.slice(0, usableAbsolute.index) }).title
    return unknownResult(ctx, compact({ series, absoluteEpisode: usableAbsolute.number }))
  }

  if (date !== undefined) {
    if (ctx.parents.length > 0) return episodeResult(ctx, { kind: 'date', hit: date }, undefined)
    const title = parseTitleFragment(
      { value: value.slice(0, date.index) },
      { detectParts: false, detectYear: false },
    ).title
    return unknownResult(ctx, compact({ title, airDate: date.airDate }))
  }

  return movieResult(ctx, false)
}
