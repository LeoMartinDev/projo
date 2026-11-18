import type { AppError, Result } from '@projo/shared'
import type { TvProgrammeKind } from '@projo/shared/api/tv'

import { channelKindOf, programmeKindOf } from './programme-kind.ts'

/** A text of the guide in one language (XMLTV `lang`), as read. */
export type TvGuideText = { lang?: string; text: string }

/** A channel of the guide (XMLTV `<channel>`): its id and display names. */
export type TvGuideChannel = { id: string; names: string[] }

/** A programme's episode (§29.3): numbers from 1; `label` the on-screen text. */
export type TvEpisode = { season?: number; episode?: number; label?: string }

/** A programme as a guide reader yields it (§29.3), before matching and cleaning. */
export type TvGuideProgramme = {
  /** The guide's channel id (XMLTV `channel`). */
  channel: string
  start: Date
  stop?: Date
  titles: TvGuideText[]
  subtitles: TvGuideText[]
  descriptions: TvGuideText[]
  categories: TvGuideText[]
  /** Image URLs as read (XMLTV `<icon src>`), the first usable one kept. */
  images?: string[]
  episode?: TvEpisode
}

/** Where a reader hands the guide as it reads it: the channels first, then each programme. */
export type TvGuideSink = {
  channel: (channel: TvGuideChannel) => void
  programme: (programme: TvGuideProgramme) => void
}

export type TvGuideError = AppError<'tv/guide_unreachable' | 'tv/guide_invalid'>

/** `available: false`: the source has no guide location (nothing was fetched). */
export type TvGuideRead = Result<{ available: boolean }, TvGuideError>

/** A programme as a guide read settles it (§29.3), times in UTC; stored with an id. */
export type TvProgrammeData = {
  channelId: string
  startAt: Date
  endAt: Date
  title: string
  subtitle?: string
  description?: string
  /** At most 3, in the server's language first. */
  categories: TvGuideText[]
  kind: TvProgrammeKind
  episode?: TvEpisode
  imageUrl?: string
}

/**
 * A stored programme (§29.3): `imageKey` names its image in `TvProgrammeImageRepository`,
 * `imageStored` once it is downloaded.
 */
export type TvProgramme = TvProgrammeData & {
  id: string
  imageKey?: string
  imageStored: boolean
}

export type TvNowNext = { now?: TvProgramme; next?: TvProgramme }

/** A programme as the guide grid reads it (§29.7): no subtitle, description nor image. */
export type TvScheduleProgramme = Pick<
  TvProgramme,
  'id' | 'channelId' | 'startAt' | 'endAt' | 'title' | 'kind' | 'episode'
>

export type TvGuideRepository = {
  /**
   * Replaces every programme of the source's channels with `programmes` (one transaction),
   * keeping the id of a programme whose channel and start were stored, and deletes every
   * programme ended before `now` − 6 hours.
   */
  replaceForSource: (input: { sourceId: string; programmes: TvProgrammeData[]; now: Date }) => void
  /** Deletes the programmes ended before `now` − 6 hours (§29.3); returns how many. */
  deleteEnded: (now: Date) => number
  /**
   * Now and next (§29.3) at `at` of every enabled, present channel that has one of them; the
   * candidates are each channel's first two programmes ending after `at`, by start.
   */
  nowAndNext: (at: Date) => Map<string, TvNowNext>
  /** A stored programme of a present channel. */
  findProgramme: (id: string) => TvProgramme | undefined
  /** The channel's programme that starts at or after `at` first. */
  programmeAfter: (input: { channelId: string; at: Date }) => TvProgramme | undefined
  /**
   * The programmes overlapping `[from, to)` (starting before `to`, ending after `from`) of those
   * of `channelIds` that are enabled and present, by channel then start.
   */
  schedule: (input: {
    channelIds: readonly string[]
    from: Date
    to: Date
  }) => TvScheduleProgramme[]
}

/** A guide channel as the admin picks it (§29.3): the source's list of its last read. */
export type TvGuideChannelRepository = {
  /** Replaces the source's guide channels with the last read's (at most 20,000). */
  replaceForSource: (input: { sourceId: string; channels: readonly TvGuideChannel[] }) => void
  /** `search` is a `searchNameOf` value, matched in ids and display names. */
  list: (input: { sourceId: string; search?: string; offset: number; limit: number }) => {
    items: TvGuideChannel[]
    total: number
  }
  /** The listed guide channels of these ids (lowercased keys). */
  findMany: (input: { sourceId: string; ids: readonly string[] }) => Map<string, TvGuideChannel>
}

/** Programmes are kept from this long ago (§29.3). */
export const TV_GUIDE_PAST_MS = 6 * 60 * 60_000
/** … to this far ahead (§29.3). */
export const TV_GUIDE_AHEAD_MS = 72 * 60 * 60_000
/** A source's guide is read again once its last attempt is this old (§29.3). */
export const TV_GUIDE_REFRESH_INTERVAL_MS = 6 * 60 * 60_000
/** Programmes kept per channel (§29.3). */
export const TV_GUIDE_MAX_PER_CHANNEL = 600
/** Programmes a channel holds while the guide is read: bounds memory on a hostile guide. */
const MAX_CANDIDATES_PER_CHANNEL = 3000
/** Guide channels stored per source, and display names per channel (§29.3). */
export const TV_GUIDE_MAX_CHANNELS = 20_000
const MAX_GUIDE_CHANNEL_NAMES = 5
const MAX_CATEGORIES = 3
const MAX_IMAGE_URL_LENGTH = 2048

export const tvGuideTextLimits = {
  title: 300,
  subtitle: 300,
  description: 2000,
  category: 100,
  episodeLabel: 40,
  guideChannelName: 100,
}

const xmltvTime = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*(?:(Z)|([+-])(\d{2}):?(\d{2}))?$/u

/**
 * An XMLTV time (§29.3): `YYYYMMDDhhmm[ss]`, then an optional offset (`±hhmm`, `±hh:mm`, `Z`);
 * without one, UTC. `undefined` when it does not parse or names no real moment.
 */
export const parseXmltvTime = (value: string): Date | undefined => {
  const match = xmltvTime.exec(value.trim()) ?? undefined
  if (match === undefined) return undefined
  const [, year, month, day, hour, minute, second = '0', , sign, offsetHours, offsetMinutes] = match
  const parts = [year, month, day, hour, minute, second].map(Number)
  const [y = 0, mo = 0, d = 0, h = 0, mi = 0, s = 0] = parts
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return undefined
  const local = Date.UTC(y, mo - 1, d, h, mi, s)
  // Day 31 of a 30-day month rolls over: not a real date.
  if (new Date(local).getUTCDate() !== d) return undefined
  const offsetMs =
    sign === undefined
      ? 0
      : (sign === '-' ? -1 : 1) * (Number(offsetHours) * 60 + Number(offsetMinutes)) * 60_000
  if (Math.abs(offsetMs) > 14 * 60 * 60_000) return undefined
  return new Date(local - offsetMs)
}

/** Trimmed, whitespace collapsed, cut to `max` characters; `undefined` when empty. */
export const cleanGuideText = (value: string, max: number): string | undefined => {
  const text = value.replace(/\s+/gu, ' ').trim()
  if (text === '') return undefined
  const characters = [...text]
  return characters.length <= max ? text : characters.slice(0, max).join('').trimEnd()
}

const primaryOf = (tag: string): string => tag.trim().toLowerCase().split(/[-_]/u)[0] ?? ''

/**
 * Of several texts in different languages (§29.3): the one in `language` (its primary subtag),
 * else one without `lang`, else the first. Empty texts never count.
 */
export const pickGuideText = (
  texts: readonly TvGuideText[],
  language: string,
): string | undefined => {
  const present = texts.filter((text) => text.text.trim() !== '')
  const wanted = primaryOf(language)
  return (
    present.find((text) => text.lang !== undefined && primaryOf(text.lang) === wanted) ??
    present.find((text) => text.lang === undefined || text.lang.trim() === '') ??
    present[0]
  )?.text
}

/**
 * Up to 3 categories (§29.3) in the order read, cleaned, an empty one or a repeat (ignoring case)
 * skipped.
 */
export const cleanCategories = (categories: readonly TvGuideText[]): TvGuideText[] => {
  const kept: TvGuideText[] = []
  const seen = new Set<string>()
  for (const category of categories) {
    if (kept.length >= MAX_CATEGORIES) break
    const text = cleanGuideText(category.text, tvGuideTextLimits.category)
    if (text === undefined || seen.has(text.toLowerCase())) continue
    seen.add(text.toLowerCase())
    const lang = category.lang?.trim()
    kept.push({ text, ...(lang === undefined || lang === '' ? {} : { lang }) })
  }
  return kept
}

/** The categories in `language` first, the others after, each group in its order. */
const inLanguageFirst = (categories: readonly TvGuideText[], language: string): TvGuideText[] => {
  const wanted = primaryOf(language)
  const inLanguage = (text: TvGuideText) =>
    text.lang !== undefined && primaryOf(text.lang) === wanted
  return [...categories.filter(inLanguage), ...categories.filter((text) => !inLanguage(text))]
}

/** The first usable image URL (§29.3): absolute `http`/`https`, 2,048 characters at most. */
export const programmeImageOf = (urls: readonly string[] | undefined): string | undefined =>
  (urls ?? [])
    .map((url) => url.trim())
    .find(
      (url) =>
        url.length <= MAX_IMAGE_URL_LENGTH &&
        /^https?:\/\/[^\s/?#]+/iu.test(url) &&
        URL.canParse(url) &&
        /^https?:$/u.test(new URL(url).protocol),
    )

const episodePart = (value: string | undefined): number | undefined => {
  const number = (value ?? '').replace(/\s+/gu, '').split('/')[0] ?? ''
  return /^\d{1,5}$/u.test(number) ? Number(number) + 1 : undefined
}

/**
 * A programme's episode from its `<episode-num>`s (§29.3): `xmltv_ns` numbers (`season.episode.part`,
 * zero-based), else the `onscreen` text; other systems ignored.
 */
export const episodeOfXmltv = (
  numbers: readonly { system?: string; text: string }[],
): TvEpisode | undefined => {
  for (const { system, text } of numbers) {
    if (system?.trim().toLowerCase() !== 'xmltv_ns') continue
    const [seasonPart, episodePartText] = text.split('.')
    const season = episodePart(seasonPart)
    const episode = episodePart(episodePartText)
    if (season !== undefined || episode !== undefined)
      return {
        ...(season === undefined ? {} : { season }),
        ...(episode === undefined ? {} : { episode }),
      }
  }
  for (const { system, text } of numbers) {
    if (system?.trim().toLowerCase() !== 'onscreen') continue
    const label = cleanGuideText(text, tvGuideTextLimits.episodeLabel)
    if (label !== undefined) return { label }
  }
  return undefined
}

const qualityWords = new Set([
  'sd',
  'hd',
  'fhd',
  'uhd',
  '4k',
  '8k',
  'hevc',
  'h264',
  'h265',
  'hdr',
  '50fps',
  'backup',
])
const isQualityWord = (word: string): boolean =>
  qualityWords.has(word) || /^\d{3,4}[pi]$/u.test(word)

/**
 * A channel name as the guide matches it (§29.3): without case, accents, country prefix,
 * bracketed parts, quality words nor anything but letters and digits; `''` when nothing is left.
 */
export const guideNameOf = (name: string): string => {
  const words = (text: string) => text.split(/[^\p{L}\p{N}]+/u).filter((word) => word !== '')
  const plain = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/^\|?\s*[a-z]{2,3}\s*(?:[:|]|\s-)\s*/u, '')
    .replace(/\[[^\]]*\]/gu, ' ')
    .replace(/\(([^)]*)\)/gu, (whole, inner: string) => {
      const inside = words(inner)
      return inside.length > 0 && inside.every(isQualityWord) ? ' ' : whole
    })
    .replaceAll('+', ' plus ')
    .replaceAll('&', ' and ')
  return words(plain)
    .filter((word) => !isQualityWord(word))
    .join('')
}

/** A guide key without its `@…` suffix (iptv-org's `France2.fr@SD`), lowercased (§29.3). */
export const guideKeyStem = (key: string): string => {
  const lower = key.trim().toLowerCase()
  const at = lower.indexOf('@')
  return at > 0 ? lower.slice(0, at) : lower
}

/**
 * A channel of the source the guide fills (enabled and present, §29.3): its guide key, the admin's
 * guide channel when chosen, and its group name for its kind.
 */
export type TvGuideTarget = {
  id: string
  name: string
  group: string
  guideKey?: string
  guideChannel?: string
}

type Candidate = {
  start: Date
  stop?: Date
  title: string
  subtitle?: string
  description?: string
  categories: TvGuideText[]
  kind: TvProgrammeKind
  episode?: TvEpisode
  imageUrl?: string
}

const pushTo = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
  const list = map.get(key)
  if (list === undefined) map.set(key, [value])
  else list.push(value)
}

/**
 * One channel's programmes once read (§29.3): sorted by start, duplicates (same start) dropped
 * keeping the first read, each cut at the next one's start (which also ends one without a stop),
 * then those in the window `(now − 6 h, now + 72 h)`, 600 at most.
 */
export const settleProgrammes = (
  channelId: string,
  candidates: readonly Candidate[],
  now: Date,
): TvProgrammeData[] => {
  const sorted = candidates
    .map((candidate, order) => ({ candidate, order }))
    .sort((a, b) => a.candidate.start.getTime() - b.candidate.start.getTime() || a.order - b.order)
    .map(({ candidate }) => candidate)
  const unique = sorted.filter(
    (candidate, index) =>
      index === 0 || sorted[index - 1]?.start.getTime() !== candidate.start.getTime(),
  )
  const windowStart = now.getTime() - TV_GUIDE_PAST_MS
  const windowEnd = now.getTime() + TV_GUIDE_AHEAD_MS
  const settled: TvProgrammeData[] = []
  for (const [index, candidate] of unique.entries()) {
    const following = unique[index + 1]?.start.getTime() ?? Number.POSITIVE_INFINITY
    const end = Math.min(candidate.stop?.getTime() ?? Number.POSITIVE_INFINITY, following)
    const start = candidate.start.getTime()
    if (!Number.isFinite(end) || end <= start) continue
    if (end <= windowStart || start >= windowEnd) continue
    const { subtitle, description, episode, imageUrl } = candidate
    settled.push({
      channelId,
      startAt: candidate.start,
      endAt: new Date(end),
      title: candidate.title,
      ...(subtitle === undefined ? {} : { subtitle }),
      ...(description === undefined ? {} : { description }),
      categories: candidate.categories,
      kind: candidate.kind,
      ...(episode === undefined ? {} : { episode }),
      ...(imageUrl === undefined ? {} : { imageUrl }),
    })
    if (settled.length >= TV_GUIDE_MAX_PER_CHANNEL) break
  }
  return settled
}

/** What a guide read settled (§29.3). */
export type TvGuideCollected = {
  programmes: TvProgrammeData[]
  /** Per target channel: the guide channel it took, `undefined` when none. */
  matches: Map<string, string | undefined>
  /** The guide's `<channel>`s read before its first programme, at most 20,000. */
  guideChannels: TvGuideChannel[]
}

/**
 * Collects a source's guide as it is read (§29.3): places each channel on a guide channel (the
 * admin's choice, the guide key, the key without its `@…` suffix, the normalised name), keeps only
 * the matched programmes that may fall in the window or close one that does, picks their texts in
 * `language`, gives each its kind, and settles each channel's programmes once the read is done.
 */
export const createGuideCollector = ({
  channels,
  now,
  language,
}: {
  channels: readonly TvGuideTarget[]
  now: Date
  language: string
}) => {
  const listed: TvGuideChannel[] = []
  const listedIds = new Set<string>()
  const channelKinds = new Map(
    channels.map((channel) => [channel.id, channelKindOf(channel)] as const),
  )
  // Built once the channels are read (at the first programme): guide channel (lowercased) →
  // targets; and, for keys no rule placed, the key without suffix → targets.
  let routes: Map<string, string[]> | undefined
  const stemRoutes = new Map<string, string[]>()
  const matches = new Map<string, string | undefined>(
    channels.map((channel) => [channel.id, undefined]),
  )
  const candidates = new Map<string, Candidate[]>()
  // A key no rule placed takes the programmes of its own key, else those of its stem (§29.3):
  // the stem's are held apart, and used only by a channel that got none of its own.
  const stemCandidates = new Map<string, Candidate[]>()
  const stemMatches = new Map<string, string>()
  const windowStart = now.getTime() - TV_GUIDE_PAST_MS
  const windowEnd = now.getTime() + TV_GUIDE_AHEAD_MS
  // Everything that starts from a day before the window is kept, ended or not: a programme
  // without a stop may run into the window, and the one that follows it, even ended, is what
  // closes it. The window is applied once every stop is settled (`settleProgrammes`).
  const earliestKeptStart = windowStart - 24 * 60 * 60_000

  const resolve = (): Map<string, string[]> => {
    const byId = new Map<string, TvGuideChannel>()
    const byStem = new Map<string, TvGuideChannel>()
    const byName = new Map<string, TvGuideChannel>()
    for (const channel of listed) {
      const lower = channel.id.toLowerCase()
      if (!byId.has(lower)) byId.set(lower, channel)
      const stem = guideKeyStem(channel.id)
      if (!byStem.has(stem)) byStem.set(stem, channel)
      for (const name of channel.names) {
        const normalized = guideNameOf(name)
        if (normalized !== '' && !byName.has(normalized)) byName.set(normalized, channel)
      }
    }
    const placed = new Map<string, string[]>()
    for (const target of channels) {
      const manual = target.guideChannel?.trim()
      if (manual !== undefined && manual !== '') {
        const listedOne = byId.get(manual.toLowerCase())
        pushTo(placed, manual.toLowerCase(), target.id)
        if (listedOne !== undefined) matches.set(target.id, listedOne.id)
        continue
      }
      const key = target.guideKey?.trim() ?? ''
      const found =
        (key === '' ? undefined : (byId.get(key.toLowerCase()) ?? byStem.get(guideKeyStem(key)))) ??
        byName.get(guideNameOf(target.name) || '\u0000')
      if (found !== undefined) {
        pushTo(placed, found.id.toLowerCase(), target.id)
        matches.set(target.id, found.id)
      } else if (key !== '') {
        pushTo(placed, key.toLowerCase(), target.id)
        pushTo(stemRoutes, guideKeyStem(key), target.id)
      }
    }
    return placed
  }

  const sink: TvGuideSink = {
    channel: ({ id, names }) => {
      if (routes !== undefined || listed.length >= TV_GUIDE_MAX_CHANNELS) return
      const trimmed = id.trim()
      if (trimmed === '' || listedIds.has(trimmed.toLowerCase())) return
      listedIds.add(trimmed.toLowerCase())
      const kept: string[] = []
      for (const name of names) {
        const text = cleanGuideText(name, tvGuideTextLimits.guideChannelName)
        if (text !== undefined && !kept.includes(text)) kept.push(text)
        if (kept.length >= MAX_GUIDE_CHANNEL_NAMES) break
      }
      listed.push({ id: trimmed, names: kept })
    },
    programme: (programme) => {
      routes ??= resolve()
      const lower = programme.channel.trim().toLowerCase()
      const targets = routes.get(lower) ?? []
      const stemTargets = (stemRoutes.get(guideKeyStem(lower)) ?? []).filter(
        (target) => !targets.includes(target),
      )
      if (targets.length === 0 && stemTargets.length === 0) return
      const start = programme.start.getTime()
      if (start >= windowEnd) return
      const stop = programme.stop?.getTime()
      if (start < earliestKeptStart && (stop === undefined || stop <= windowStart)) return
      const title = cleanGuideText(
        pickGuideText(programme.titles, language) ?? '',
        tvGuideTextLimits.title,
      )
      if (title === undefined) return
      const subtitle = cleanGuideText(
        pickGuideText(programme.subtitles, language) ?? '',
        tvGuideTextLimits.subtitle,
      )
      const description = cleanGuideText(
        pickGuideText(programme.descriptions, language) ?? '',
        tvGuideTextLimits.description,
      )
      const categories = cleanCategories(programme.categories)
      const imageUrl = programmeImageOf(programme.images)
      const { episode } = programme
      const add = (into: Map<string, Candidate[]>, target: string) => {
        const list = into.get(target)
        if (list !== undefined && list.length >= MAX_CANDIDATES_PER_CHANNEL) return
        pushTo(into, target, {
          start: programme.start,
          ...(programme.stop === undefined ? {} : { stop: programme.stop }),
          title,
          ...(subtitle === undefined ? {} : { subtitle }),
          ...(description === undefined ? {} : { description }),
          categories: inLanguageFirst(categories, language),
          kind: programmeKindOf(categories, channelKinds.get(target) ?? 'other'),
          ...(episode === undefined ? {} : { episode }),
          ...(imageUrl === undefined ? {} : { imageUrl }),
        })
      }
      for (const target of targets) {
        if (matches.get(target) === undefined) matches.set(target, programme.channel.trim())
        add(candidates, target)
      }
      for (const target of stemTargets) {
        if (!stemMatches.has(target)) stemMatches.set(target, programme.channel.trim())
        add(stemCandidates, target)
      }
    },
  }

  return {
    sink,
    /** The settled programmes of every matched channel, what matched, and the guide's channels. */
    finish: (): TvGuideCollected => {
      routes ??= resolve()
      for (const [target, list] of stemCandidates) {
        if (candidates.has(target)) continue
        candidates.set(target, list)
        matches.set(target, stemMatches.get(target))
      }
      return {
        programmes: [...candidates.entries()].flatMap(([channelId, list]) =>
          settleProgrammes(channelId, list, now),
        ),
        matches,
        guideChannels: listed,
      }
    },
  }
}

/**
 * Now and next of one channel at `at` (§29.3), from its first programmes ending after `at`,
 * sorted by start: *now* starts at or before `at`, *next* is the first starting after it.
 */
export const nowAndNextOf = (programmes: readonly TvProgramme[], at: Date): TvNowNext => {
  const time = at.getTime()
  const now = programmes.find(
    (programme) => programme.startAt.getTime() <= time && programme.endAt.getTime() > time,
  )
  const next = programmes.find((programme) => programme.startAt.getTime() > time)
  return {
    ...(now === undefined ? {} : { now }),
    ...(next === undefined ? {} : { next }),
  }
}

const guideKeyPrefix = 'tv_guide:'

/** `dedupe_key` of a source's `refresh_tv_guide` (§18). */
export const tvGuideDedupeKey = (sourceId: string): string => `${guideKeyPrefix}${sourceId}`
