import { extensionOf, fileName, parentSegments, splitPath, stemOf } from './path'

export const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set([
  'mkv',
  'mp4',
  'm4v',
  'mov',
  'avi',
  'webm',
  'ts',
  'm2ts',
  'wmv',
])
export const SUBTITLE_EXTENSIONS: ReadonlySet<string> = new Set([
  'srt',
  'ass',
  'ssa',
  'vtt',
  'sub',
  'idx',
  'sup',
])
const INCOMPLETE_EXTENSIONS: ReadonlySet<string> = new Set([
  'part',
  '!qb',
  'crdownload',
  'tmp',
  'partial',
  'aria2',
  'download',
  'bak',
])
const UNSUPPORTED_FILE_EXTENSIONS: ReadonlySet<string> = new Set(['iso', 'disc'])
const UNSUPPORTED_DIRECTORIES: ReadonlySet<string> = new Set(['video_ts', 'bdmv'])

/** Files whose presence excludes their folder and its whole subtree (§8.6). Their content is not read in v1. */
export const IGNORE_MARKER_FILES: ReadonlySet<string> = new Set(['.ignore', '.nomedia'])

/** §7.2: below this size a video is never a candidate. */
export const MIN_VIDEO_SIZE_BYTES = 1_000_000

const EXCLUDED_NAMES: ReadonlySet<string> = new Set([
  '@eadir',
  '#recycle',
  '@recycle',
  '$recycle.bin',
  'system volume information',
  'lost+found',
  '.grab',
  'metadata',
  'extrafanart',
  'extrathumbs',
  '.actors',
  'thumbs.db',
  '.ds_store',
])

const BONUS_DIRECTORIES: ReadonlySet<string> = new Set([
  'trailers',
  'trailer',
  'behind the scenes',
  'deleted scenes',
  'interviews',
  'scenes',
  'featurettes',
  'shorts',
  'extras',
  'extra',
  'other',
  'clips',
  'samples',
  'sample',
  'backdrops',
  'theme-music',
])

const BONUS_SUFFIXES: readonly string[] = [
  '-trailer',
  '.trailer',
  '_trailer',
  ' - trailer',
  '-sample',
  '.sample',
  '-scene',
  '-clip',
  '-interview',
  '-behindthescenes',
  '-deleted',
  '-deletedscene',
  '-featurette',
  '-short',
  '-extra',
  '-other',
]

const BONUS_STEMS: ReadonlySet<string> = new Set(['trailer', 'sample'])

export type IgnoreReason =
  | 'hidden'
  | 'excluded'
  | 'ignore_marker'
  | 'bonus'
  | 'incomplete'
  | 'unsupported_layout'
  | 'not_media'
  | 'too_small'

export type FileFilterResult =
  | { readonly kind: 'video' }
  | { readonly kind: 'subtitle' }
  | { readonly kind: 'ignored'; readonly reason: IgnoreReason }

export type DirectoryFilterResult =
  { readonly kind: 'descend' } | { readonly kind: 'skip'; readonly reason: IgnoreReason }

const isHidden = (name: string): boolean => name.startsWith('.')

const isExcludedName = (name: string): boolean => {
  const lower = name.toLowerCase()
  return EXCLUDED_NAMES.has(lower) || lower.endsWith('.trickplay')
}

export const isBonusDirectoryName = (name: string): boolean =>
  BONUS_DIRECTORIES.has(name.normalize('NFC').trim().toLowerCase())

/** §8.5 file rules: `-trailer`-like suffixes (trailing digits ignored), `trailer.*`, `sample.*`, `*.sample.*`. */
export const isBonusFileName = (name: string): boolean => {
  const stem = stemOf(name)
    .toLowerCase()
    .replace(/[\s._-]*\d+$/u, '')
  return BONUS_STEMS.has(stem) || BONUS_SUFFIXES.some((suffix) => stem.endsWith(suffix))
}

const STEREO_3D_TOKENS: ReadonlySet<string> = new Set([
  'hsbs',
  'fsbs',
  'htab',
  'ftab',
  'hou',
  'mvc',
  'sbs3d',
  '3dsbs',
])
const STEREO_3D_LAYOUTS: ReadonlySet<string> = new Set(['sbs', 'ou', 'tab'])
const STEREO_3D_PREFIXES: ReadonlySet<string> = new Set(['h', 'half', 'f', 'full'])

/** 3D releases (`HSBS`, `Half-OU`, `3D.SBS`, `MVC`). A lone `3D` is kept: it is part of many titles (`Step Up 3D`). */
export const isStereo3dName = (name: string): boolean => {
  const tokens = stemOf(name)
    .toLowerCase()
    .split(/[\s._\-()[\]]+/u)
    .filter((t) => t !== '')
  const has3d = tokens.includes('3d')
  return tokens.some((token, i) => {
    if (STEREO_3D_TOKENS.has(token)) return true
    if (!STEREO_3D_LAYOUTS.has(token)) return false
    return has3d || STEREO_3D_PREFIXES.has(tokens[i - 1] ?? '')
  })
}

const pathSegmentReason = (
  segments: readonly string[],
  directories: readonly string[],
): IgnoreReason | undefined => {
  if (segments.some(isHidden)) return 'hidden'
  if (segments.some(isExcludedName)) return 'excluded'
  if (directories.some((d) => UNSUPPORTED_DIRECTORIES.has(d.toLowerCase())))
    return 'unsupported_layout'
  if (directories.some(isBonusDirectoryName)) return 'bonus'
  return undefined
}

/**
 * Filter step of §7.2 for one file (path relative to the library root). Excluded-by-marker folders are the walker's
 * job (see `filterDirectory`): it stops descending there.
 */
export const filterFile = ({
  relativePath,
  sizeBytes,
}: {
  readonly relativePath: string
  readonly sizeBytes: number
}): FileFilterResult => {
  const normalized = relativePath.normalize('NFC')
  const segments = splitPath(normalized)
  const name = fileName(normalized)
  const segmentReason = pathSegmentReason(segments, parentSegments(normalized))
  if (segmentReason !== undefined) return { kind: 'ignored', reason: segmentReason }
  const extension = extensionOf(name)
  if (INCOMPLETE_EXTENSIONS.has(extension)) return { kind: 'ignored', reason: 'incomplete' }
  if (UNSUPPORTED_FILE_EXTENSIONS.has(extension))
    return { kind: 'ignored', reason: 'unsupported_layout' }
  if (SUBTITLE_EXTENSIONS.has(extension)) return { kind: 'subtitle' }
  if (!VIDEO_EXTENSIONS.has(extension)) return { kind: 'ignored', reason: 'not_media' }
  if (isBonusFileName(name)) return { kind: 'ignored', reason: 'bonus' }
  if (isStereo3dName(name)) return { kind: 'ignored', reason: 'unsupported_layout' }
  if (sizeBytes < MIN_VIDEO_SIZE_BYTES) return { kind: 'ignored', reason: 'too_small' }
  return { kind: 'video' }
}

/**
 * Whether the walker should enter a directory. `entryNames` are the names directly inside it (to spot `.ignore` /
 * `.nomedia`). The library root is `''`: only markers apply to it.
 */
export const filterDirectory = ({
  relativePath,
  entryNames,
}: {
  readonly relativePath: string
  readonly entryNames: readonly string[]
}): DirectoryFilterResult => {
  const segments = splitPath(relativePath.normalize('NFC'))
  const segmentReason = pathSegmentReason(segments, segments)
  if (segmentReason !== undefined) return { kind: 'skip', reason: segmentReason }
  if (entryNames.some((entry) => IGNORE_MARKER_FILES.has(entry.toLowerCase())))
    return { kind: 'skip', reason: 'ignore_marker' }
  return { kind: 'descend' }
}
