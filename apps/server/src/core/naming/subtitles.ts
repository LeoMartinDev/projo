import { normalizeLanguage } from './languages'
import { directoryOf, extensionOf, fileName, joinPath, splitPath, stemOf } from './path'

export type SubtitleFormat = 'srt' | 'ass' | 'ssa' | 'vtt' | 'vobsub' | 'pgs'

export type SubtitleTags = {
  /** BCP 47 style (`fr`, `pt-BR`); absent = unknown language ("Sous-titres"). */
  readonly language?: string
  readonly forced: boolean
  readonly sdh: boolean
  readonly isDefault: boolean
  /** Any text that is neither a language nor a flag. */
  readonly title?: string
}

export type ExternalSubtitle = SubtitleTags & {
  /** For VobSub, the `.idx` file (its `.sub` sibling holds the bitmaps). */
  readonly subtitlePath: string
  readonly videoPath: string
  readonly format: SubtitleFormat
  /** Bitmap formats can only be burnt in (§10.4). */
  readonly rendering: 'text' | 'bitmap'
}

const TEXT_FORMATS: Readonly<Record<string, SubtitleFormat>> = {
  srt: 'srt',
  ass: 'ass',
  ssa: 'ssa',
  vtt: 'vtt',
}

const FORCED_FLAGS: ReadonlySet<string> = new Set(['forced', 'foreign'])
const SDH_FLAGS: ReadonlySet<string> = new Set(['sdh', 'cc'])

/**
 * Reads language and flags from suffix tokens (§8.3). `hi` alone is Hindi; after a language it means SDH (`en.hi`).
 * Once a language is set, further language-looking tokens go to the title.
 */
export const parseSubtitleTags = (tokens: readonly string[]): SubtitleTags => {
  let language: string | undefined
  let forced = false
  let sdh = false
  let isDefault = false
  const titleParts: string[] = []
  for (const token of tokens) {
    const lower = token.toLowerCase()
    if (lower === '') continue
    if (FORCED_FLAGS.has(lower)) forced = true
    else if (SDH_FLAGS.has(lower)) sdh = true
    else if (lower === 'default') isDefault = true
    else if (lower === 'hi' && language !== undefined) sdh = true
    else {
      const asLanguage = language === undefined ? normalizeLanguage(token) : undefined
      if (asLanguage === undefined) titleParts.push(token)
      else language = asLanguage
    }
  }
  const title = titleParts.join(' ').trim()
  return {
    ...(language === undefined ? {} : { language }),
    forced,
    sdh,
    isDefault,
    ...(title === '' ? {} : { title }),
  }
}

const formatOf = (path: string, subtitlePaths: ReadonlySet<string>): SubtitleFormat | undefined => {
  const extension = extensionOf(fileName(path))
  const text = TEXT_FORMATS[extension]
  if (text !== undefined) return text
  if (extension === 'sup') return 'pgs'
  if (extension !== 'idx') return undefined
  const stem = stemOf(path)
  return subtitlePaths.has(`${stem}.sub`) || subtitlePaths.has(`${stem}.SUB`) ? 'vobsub' : undefined
}

/** Longest video stem that the subtitle stem equals or extends with `.` (Jellyfin) or `-` (Infuse). */
const matchByName = (
  subtitleStem: string,
  videos: readonly string[],
): { video: string; suffix: string } | undefined => {
  const lowerStem = subtitleStem.toLowerCase()
  const candidates = videos.flatMap((video) => {
    const videoStem = stemOf(fileName(video)).toLowerCase()
    if (lowerStem === videoStem) return [{ video, suffix: '', length: videoStem.length }]
    const separator = lowerStem[videoStem.length]
    if (lowerStem.startsWith(videoStem) && (separator === '.' || separator === '-')) {
      return [{ video, suffix: subtitleStem.slice(videoStem.length + 1), length: videoStem.length }]
    }
    return []
  })
  const best = candidates.reduce<(typeof candidates)[number] | undefined>(
    (acc, c) => (acc === undefined || c.length > acc.length ? c : acc),
    undefined,
  )
  return best === undefined ? undefined : { video: best.video, suffix: best.suffix }
}

const isSubsFolder = (name: string): boolean => name.toLowerCase() === 'subs'

const groupByDirectory = (paths: readonly string[]): ReadonlyMap<string, readonly string[]> => {
  const groups = new Map<string, string[]>()
  for (const path of paths) {
    const dir = directoryOf(path)
    groups.set(dir, [...(groups.get(dir) ?? []), path])
  }
  return groups
}

const subsFolderTokens = (stem: string): readonly string[] =>
  stem.split(/[\s._\-()[\]]+/u).filter((token) => token !== '' && !/^\d+$/u.test(token))

/**
 * Attaches external subtitle files to their video (§8.3): same folder and same base name with a `.`/`-` suffix,
 * or anywhere under a `Subs/` folder whose parent holds a single video. Unmatched subtitles are left out.
 * `.sub` is only read as VobSub through its `.idx` sibling.
 */
export const matchExternalSubtitles = ({
  videoPaths,
  subtitlePaths,
}: {
  readonly videoPaths: readonly string[]
  readonly subtitlePaths: readonly string[]
}): readonly ExternalSubtitle[] => {
  const normalizedVideos = videoPaths.map((p) => joinPath(splitPath(p.normalize('NFC'))))
  const normalizedSubtitles = subtitlePaths.map((p) => joinPath(splitPath(p.normalize('NFC'))))
  const subtitleSet: ReadonlySet<string> = new Set(normalizedSubtitles)
  const videosByDir = groupByDirectory(normalizedVideos)

  return normalizedSubtitles.flatMap((subtitlePath): ExternalSubtitle[] => {
    const format = formatOf(subtitlePath, subtitleSet)
    if (format === undefined) return []
    const rendering = format === 'vobsub' || format === 'pgs' ? 'bitmap' : 'text'
    const stem = stemOf(fileName(subtitlePath))
    const build = (videoPath: string, tags: SubtitleTags): ExternalSubtitle[] => [
      { ...tags, subtitlePath, videoPath, format, rendering },
    ]

    const sameFolder = matchByName(stem, videosByDir.get(directoryOf(subtitlePath)) ?? [])
    if (sameFolder !== undefined) {
      return build(
        sameFolder.video,
        parseSubtitleTags(sameFolder.suffix === '' ? [] : sameFolder.suffix.split('.')),
      )
    }

    const segments = splitPath(directoryOf(subtitlePath))
    const subsIndex = segments.findLastIndex(isSubsFolder)
    if (subsIndex < 0) return []
    const ownerVideos = videosByDir.get(joinPath(segments.slice(0, subsIndex))) ?? []
    const byName = matchByName(stem, ownerVideos)
    if (byName !== undefined) {
      return build(
        byName.video,
        parseSubtitleTags(byName.suffix === '' ? [] : byName.suffix.split('.')),
      )
    }
    const [onlyVideo, ...others] = ownerVideos
    if (onlyVideo === undefined || others.length > 0) return []
    return build(onlyVideo, parseSubtitleTags(subsFolderTokens(stem)))
  })
}
