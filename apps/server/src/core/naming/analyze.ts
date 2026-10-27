import {
  type AbsoluteHit,
  type DateHit,
  type EpisodeHit,
  findAbsoluteNumber,
  findAirDate,
  findBareNumbers,
  findDashNumbers,
  findEpisodeKeyword,
  findExplicitEpisode,
  findLeadingNumber,
  findSeasonDotEpisode,
  findSeasonMarker,
  parseSeasonFolder,
  type SeasonFolder,
} from './episode'
import { fileName, joinPath, parentSegments, stemOf } from './path'
import {
  fallbackTitle,
  mergeIds,
  normalizeTitle,
  type PreparedName,
  parseTitleFragment,
  prepareName,
  releaseTagIndex,
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

/**
 * Version of the name analysis rules (§8). Bump it with any change to what `analyzeMediaPath`
 * returns: the next startup reads every name again (§7.4, scan kind `rules_update`).
 */
export const NAMING_RULES_VERSION = 3

type Context = {
  readonly hint: LibraryHint
  readonly stem: string
  readonly file: PreparedName
  readonly parents: readonly string[]
  /** Nearest season folder above the file, with the folder right above it (the series folder) if any. */
  readonly seasonFolder?: SeasonFolder
  readonly seriesFolder?: string
}

/** A purely numeric folder is a season only below another folder: `24/` at the root is a show. */
const isSeasonFolderAt = (parents: readonly string[], index: number): boolean => {
  const segment = parents[index] ?? ''
  if (parseSeasonFolder(segment) === undefined) return false
  return index > 0 || !/^\d+$/u.test(segment.trim())
}

const seasonFolderIndex = (parents: readonly string[]): number =>
  parents.findLastIndex((_, index) => isSeasonFolderAt(parents, index))

/**
 * The folder holding a show's files: the one above the nearest season folder, otherwise the file's
 * own folder (`''` at the root). Files to review are identified together within it (§7.8).
 */
export const showFolderOf = (relativePath: string): string => {
  const parents = parentSegments(relativePath.normalize('NFC'))
  const seasonIndex = seasonFolderIndex(parents)
  return joinPath(seasonIndex >= 0 ? parents.slice(0, seasonIndex) : parents)
}

const buildContext = ({ relativePath, hint }: MediaPathInput): Context => {
  const normalized = relativePath.normalize('NFC')
  const stem = stemOf(fileName(normalized))
  const parents = parentSegments(normalized)
  const seasonIndex = seasonFolderIndex(parents)
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
 * Series name (§8.2 "Show name"): the folder above the season folder; otherwise what precedes the
 * episode number in the file name; otherwise (nothing precedes it) the file's folder. A folder
 * carrying an id tag always names the show; the folder's year completes a name it matches.
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

const DASH_TITLE = /^[\s._]*-[\s._]*(?=\S)/u

/** After a number read after the show name, only ` - Title` is a title: `Name 64 HD` has none. */
const dashTitleFrom = (rest: string): string | undefined =>
  DASH_TITLE.test(rest) ? episodeTitleFrom(rest.replace(DASH_TITLE, ' ')) : undefined

/**
 * Episode numbers found in a name. `nameEnd`: where the show name ends when a season marker sits
 * between it and the number (`Show S2 - 05`); `afterName`: a number read after the show name,
 * whose title only follows ` - `.
 */
type EpisodeNumbers =
  | {
      readonly kind: 'standard'
      readonly hit: EpisodeHit
      readonly afterName?: boolean
      readonly nameEnd?: number
    }
  | { readonly kind: 'absolute'; readonly hit: AbsoluteHit; readonly nameEnd?: number }
  | { readonly kind: 'date'; readonly hit: DateHit }
  | { readonly kind: 'none' }

const episodeResult = (
  ctx: Context,
  numbers: EpisodeNumbers,
  reviewReason: NamingReviewReason | undefined,
): MediaPathAnalysis => {
  const value = ctx.file.value
  const hit = numbers.kind === 'none' ? undefined : numbers.hit
  const nameEnd =
    numbers.kind === 'standard' || numbers.kind === 'absolute'
      ? (numbers.nameEnd ?? numbers.hit.index)
      : hit?.index
  const series = resolveSeries(ctx, nameEnd === undefined ? value : value.slice(0, nameEnd))
  const rest = hit === undefined ? undefined : value.slice(hit.end)
  const afterName =
    numbers.kind === 'absolute' || (numbers.kind === 'standard' && numbers.afterName === true)
  const episodeTitle =
    rest === undefined ? undefined : afterName ? dashTitleFrom(rest) : episodeTitleFrom(rest)
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

/** Title of the folder naming the show: above the season folder, otherwise the file's folder. */
const showFolderTitle = (ctx: Context): string => {
  const folderName = ctx.seasonFolder === undefined ? parentFolder(ctx) : ctx.seriesFolder
  return folderName === undefined
    ? ''
    : normalizeTitle(parseTitleFragment(folderName, { detectParts: false, detectYear: true }).title)
}

/**
 * Where the folder's title ends when the file name starts with it, otherwise 0. A number before
 * that point belongs to the title, not to an episode: `Fahrenheit 451/Fahrenheit 451.mkv`, but
 * `Station 19/Station 19 - 19.mkv` is episode 19.
 */
const folderTitleEnd = (ctx: Context): number => {
  const title = showFolderTitle(ctx)
  const value = ctx.file.value
  if (title === '') return 0
  const end = [...value.matchAll(/[\p{L}\p{N}]+/gu)]
    .map((word) => word.index + word[0].length)
    .find((wordEnd) => normalizeTitle(value.slice(0, wordEnd)) === title)
  return end ?? 0
}

/** Outside a show context, absolute numbering counts only inside a folder named like the show. */
const isInSeriesFolder = (ctx: Context, hit: AbsoluteHit): boolean => {
  const folder = showFolderTitle(ctx)
  const prefix = normalizeTitle(
    parseTitleFragment({ value: ctx.file.value.slice(0, hit.index) }).title,
  )
  if (folder === '' || prefix === '') return false
  return folder.startsWith(prefix) || prefix.startsWith(folder)
}

/**
 * A number read after the show name (`Name 64`, `Name - 12`): a season marker right before it
 * (`S2 - 05`) gives the season and ends the show name; without any season, it is absolute.
 */
const numberAfterName = (ctx: Context, hit: AbsoluteHit): EpisodeNumbers => {
  const marker = findSeasonMarker(ctx.file.value.slice(0, hit.index))
  const season = ctx.seasonFolder?.season ?? marker?.season
  const nameEnd = marker?.index ?? hit.index
  if (season === undefined) return { kind: 'absolute', hit, nameEnd }
  return {
    kind: 'standard',
    hit: { index: hit.index, end: hit.end, season, episode: hit.number },
    afterName: true,
    nameEnd,
  }
}

/**
 * Episode numbers in a show context (§8.2 "Show context": a `series` library or a season folder),
 * in this order: `Episode 02` / `E02`, a date, the first `Name - 12`, a number starting the name,
 * the last standalone number before the release tags.
 */
const showNumbers = (ctx: Context): EpisodeNumbers => {
  const value = ctx.file.value
  const folderSeason = ctx.seasonFolder?.season

  const keyword = findEpisodeKeyword(value)
  if (keyword !== undefined) {
    const marker = findSeasonMarker(value.slice(0, keyword.index))
    const season = folderSeason ?? marker?.season
    return {
      kind: 'standard',
      hit: season === undefined ? keyword : { ...keyword, season },
      ...(marker === undefined ? {} : { nameEnd: marker.index }),
    }
  }

  const date = findAirDate(value)
  if (date !== undefined) return { kind: 'date', hit: date }

  const tagsStart = releaseTagIndex(value)
  const titleEnd = folderTitleEnd(ctx)
  const usable = (hit: AbsoluteHit): boolean => hit.index < tagsStart && hit.index >= titleEnd
  const dash = findDashNumbers(value).find(usable)
  if (dash !== undefined) return numberAfterName(ctx, dash)
  const leading = findLeadingNumber(value)
  if (leading !== undefined && leading.index >= titleEnd) return { kind: 'standard', hit: leading }
  const bare = findBareNumbers(value).filter(usable).at(-1)
  if (bare !== undefined) return numberAfterName(ctx, bare)
  return { kind: 'none' }
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

  const seasonDot =
    ctx.parents.length > 0 || ctx.hint === 'series' ? findSeasonDotEpisode(value) : undefined
  if (
    seasonDot !== undefined &&
    (ctx.seasonFolder === undefined || seasonDot.season === ctx.seasonFolder.season)
  )
    return episodeResult(ctx, { kind: 'standard', hit: seasonDot }, undefined)

  if (ctx.hint === 'series' || ctx.seasonFolder !== undefined) {
    const numbers = showNumbers(ctx)
    return episodeResult(ctx, numbers, numbers.kind === 'none' ? 'no_episode_number' : undefined)
  }

  const absolute = findAbsoluteNumber(value)
  if (absolute !== undefined && absolute.index >= folderTitleEnd(ctx)) {
    if (isInSeriesFolder(ctx, absolute))
      return episodeResult(ctx, numberAfterName(ctx, absolute), undefined)
    if (absolute.form === 'dash') {
      const series = parseTitleFragment({ value: value.slice(0, absolute.index) }).title
      return unknownResult(ctx, compact({ series, absoluteEpisode: absolute.number }))
    }
  }

  const date = findAirDate(value)
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
