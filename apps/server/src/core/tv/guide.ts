import type { AppError, Result } from '@projo/shared'

/** A text of the guide in one language (XMLTV `lang`), as read. */
export type TvGuideText = { lang?: string; text: string }

/** A channel of the guide (XMLTV `<channel>`): its id and display names. */
export type TvGuideChannel = { id: string; names: string[] }

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
}

/** Where a reader hands the guide as it reads it: the channels first, then each programme. */
export type TvGuideSink = {
  channel: (channel: TvGuideChannel) => void
  programme: (programme: TvGuideProgramme) => void
}

export type TvGuideError = AppError<'tv/guide_unreachable' | 'tv/guide_invalid'>

/** `available: false`: the source has no guide location (nothing was fetched). */
export type TvGuideRead = Result<{ available: boolean }, TvGuideError>

/** A stored programme of a channel (§29.3), times in UTC. */
export type TvProgramme = {
  channelId: string
  startAt: Date
  endAt: Date
  title: string
  subtitle?: string
  description?: string
  category?: string
}

export type TvNowNext = { now?: TvProgramme; next?: TvProgramme }

export type TvGuideRepository = {
  /**
   * Replaces every programme of the source's channels with `programmes` (one transaction) and
   * deletes every programme ended at `now`.
   */
  replaceForSource: (input: { sourceId: string; programmes: TvProgramme[]; now: Date }) => void
  /** Deletes the programmes ended at `now`; returns how many. */
  deleteEnded: (now: Date) => number
  /**
   * Now and next (§29.3) at `at` of every enabled, present channel that has one of them; the
   * candidates are each channel's first two programmes ending after `at`, by start.
   */
  nowAndNext: (at: Date) => Map<string, TvNowNext>
}

/** Programmes kept from now to this far ahead (§29.3). */
export const TV_GUIDE_WINDOW_MS = 24 * 60 * 60_000
/** A source's guide is read again once its last attempt is this old (§29.3). */
export const TV_GUIDE_REFRESH_INTERVAL_MS = 6 * 60 * 60_000
/** Programmes kept per channel (§29.3). */
export const TV_GUIDE_MAX_PER_CHANNEL = 200
/** Programmes a channel holds while the guide is read: bounds memory on a hostile guide. */
const MAX_CANDIDATES_PER_CHANNEL = 2000

export const tvGuideTextLimits = { title: 300, subtitle: 300, description: 2000, category: 100 }

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

/** A channel name as the guide matches it: without case, accents nor whitespace (§29.3). */
export const guideNameOf = (name: string): string =>
  name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/gu, '')

/** A channel of the source the guide fills (enabled and present, §29.3). */
export type TvGuideTarget = { id: string; name: string; guideKey?: string }

type Candidate = {
  start: Date
  stop?: Date
  title: string
  subtitle?: string
  description?: string
  category?: string
}

const pushTo = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
  const list = map.get(key)
  if (list === undefined) map.set(key, [value])
  else list.push(value)
}

/**
 * One channel's programmes once read (§29.3): sorted by start, duplicates (same start) dropped
 * keeping the first read, each cut at the next one's start (which also ends one without a stop),
 * then those in the window `(now, now + 24 h)`, 200 at most.
 */
export const settleProgrammes = (
  channelId: string,
  candidates: readonly Candidate[],
  now: Date,
): TvProgramme[] => {
  const sorted = candidates
    .map((candidate, order) => ({ candidate, order }))
    .sort((a, b) => a.candidate.start.getTime() - b.candidate.start.getTime() || a.order - b.order)
    .map(({ candidate }) => candidate)
  const unique = sorted.filter(
    (candidate, index) =>
      index === 0 || sorted[index - 1]?.start.getTime() !== candidate.start.getTime(),
  )
  const windowEnd = now.getTime() + TV_GUIDE_WINDOW_MS
  const settled: TvProgramme[] = []
  for (const [index, candidate] of unique.entries()) {
    const following = unique[index + 1]?.start.getTime() ?? Number.POSITIVE_INFINITY
    const end = Math.min(candidate.stop?.getTime() ?? Number.POSITIVE_INFINITY, following)
    const start = candidate.start.getTime()
    if (!Number.isFinite(end) || end <= start) continue
    if (end <= now.getTime() || start >= windowEnd) continue
    const { subtitle, description, category } = candidate
    settled.push({
      channelId,
      startAt: candidate.start,
      endAt: new Date(end),
      title: candidate.title,
      ...(subtitle === undefined ? {} : { subtitle }),
      ...(description === undefined ? {} : { description }),
      ...(category === undefined ? {} : { category }),
    })
    if (settled.length >= TV_GUIDE_MAX_PER_CHANNEL) break
  }
  return settled
}

/**
 * Collects a source's guide as it is read (§29.3): matches each programme to the source's
 * channels (guide key ignoring case; a channel without one by display name), keeps only the
 * matched ones that may fall in the window or close one that does, picks their texts in `language`, and settles each
 * channel's programmes once the read is done.
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
  const byKey = new Map<string, string[]>()
  const byName = new Map<string, string[]>()
  for (const channel of channels) {
    if (channel.guideKey !== undefined && channel.guideKey !== '')
      pushTo(byKey, channel.guideKey.toLowerCase(), channel.id)
    else pushTo(byName, guideNameOf(channel.name), channel.id)
  }
  // XMLTV channel id (lowercased) → the source's channels matched by display name.
  const byGuideChannel = new Map<string, string[]>()
  const namesTaken = new Set<string>()
  const candidates = new Map<string, Candidate[]>()
  let programmesSeen = false
  const windowEnd = now.getTime() + TV_GUIDE_WINDOW_MS
  // Everything that starts from a day before is kept, ended or not: a programme without a stop may
  // run into the window, and the one that follows it, even ended, is what closes it. The window
  // is applied once every stop is settled (`settleProgrammes`).
  const earliestKeptStart = now.getTime() - TV_GUIDE_WINDOW_MS

  const targetsOf = (guideChannel: string): readonly string[] => {
    const key = guideChannel.toLowerCase()
    const byOwnKey = byKey.get(key) ?? []
    const byDisplayName = byGuideChannel.get(key) ?? []
    return byDisplayName.length === 0 ? byOwnKey : [...byOwnKey, ...byDisplayName]
  }

  const sink: TvGuideSink = {
    channel: ({ id, names }) => {
      if (programmesSeen || byName.size === 0) return
      for (const name of names) {
        const normalized = guideNameOf(name)
        const targets = byName.get(normalized)
        if (targets === undefined || namesTaken.has(normalized)) continue
        namesTaken.add(normalized)
        for (const target of targets) pushTo(byGuideChannel, id.toLowerCase(), target)
      }
    },
    programme: (programme) => {
      programmesSeen = true
      const targets = targetsOf(programme.channel)
      if (targets.length === 0) return
      const start = programme.start.getTime()
      if (start >= windowEnd) return
      const stop = programme.stop?.getTime()
      if (start < earliestKeptStart && (stop === undefined || stop <= now.getTime())) return
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
      const category = cleanGuideText(
        pickGuideText(programme.categories, language) ?? '',
        tvGuideTextLimits.category,
      )
      const candidate: Candidate = {
        start: programme.start,
        ...(programme.stop === undefined ? {} : { stop: programme.stop }),
        title,
        ...(subtitle === undefined ? {} : { subtitle }),
        ...(description === undefined ? {} : { description }),
        ...(category === undefined ? {} : { category }),
      }
      for (const target of targets) {
        const list = candidates.get(target)
        if (list !== undefined && list.length >= MAX_CANDIDATES_PER_CHANNEL) continue
        pushTo(candidates, target, candidate)
      }
    },
  }

  return {
    sink,
    /** The settled programmes of every matched channel. */
    finish: (): TvProgramme[] =>
      [...candidates.entries()].flatMap(([channelId, list]) =>
        settleProgrammes(channelId, list, now),
      ),
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
