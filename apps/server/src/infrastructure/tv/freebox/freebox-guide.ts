import type { TvEpisode, TvGuideProgramme, TvGuideText } from '../../../core/tv/guide.ts'
import { freeboxProgrammeSchema, objectEntriesSchema } from './freebox-api.ts'
import { boxUrlOf } from './freebox-channels.ts'

const HOUR_S = 3600
/** The hours read before the one that holds now, and after it (§29.3). */
export const FREEBOX_GUIDE_HOURS_BEFORE = 6
export const FREEBOX_GUIDE_HOURS_AFTER = 72
export const FREEBOX_GUIDE_HOURS = FREEBOX_GUIDE_HOURS_BEFORE + 1 + FREEBOX_GUIDE_HOURS_AFTER

/**
 * The `by_time` instants to read, in Unix seconds: one per UTC hour, from the one that holds
 * now − 6 hours to the one that holds now + 72 hours.
 */
export const freeboxGuideSlots = (now: Date): number[] => {
  const first = (Math.floor(now.getTime() / 1000 / HOUR_S) - FREEBOX_GUIDE_HOURS_BEFORE) * HOUR_S
  return Array.from({ length: FREEBOX_GUIDE_HOURS }, (_, index) => first + index * HOUR_S)
}

const texts = (value: string | undefined): TvGuideText[] =>
  value === undefined || value.trim() === '' ? [] : [{ text: value }]

const positive = (value: number | undefined): number | undefined =>
  value !== undefined && value > 0 ? value : undefined

const episodeOf = (
  season: number | undefined,
  episode: number | undefined,
): TvEpisode | undefined =>
  season === undefined && episode === undefined
    ? undefined
    : {
        ...(season === undefined ? {} : { season }),
        ...(episode === undefined ? {} : { episode }),
      }

/**
 * The programmes of one `epg/by_time` answer's `result` (§29.3): `{ <uuid>: { <key>: programme } }`.
 * `seen` holds the `<uuid>|<key>` already read (a programme spans several hours): each is
 * yielded once. Pictures are paths on the box, resolved against `address` and kept only on its
 * origin. Entries of another shape are skipped. An empty answer may be `[]`. Pure but for `seen`.
 */
export const freeboxProgrammesOf = (
  result: unknown,
  seen: Set<string>,
  address: string,
): TvGuideProgramme[] => {
  const channels = objectEntriesSchema.safeParse(result)
  if (!channels.success) return []
  return Object.entries(channels.data).flatMap(([uuid, value]) => {
    const programmes = objectEntriesSchema.safeParse(value)
    if (!programmes.success) return []
    return Object.entries(programmes.data).flatMap(([key, entry]) => {
      const parsed = freeboxProgrammeSchema.safeParse(entry)
      const id = `${uuid}|${key}`
      if (!parsed.success || seen.has(id)) return []
      seen.add(id)
      const { date, duration, title, sub_title, desc, category_name } = parsed.data
      const image =
        boxUrlOf(address, parsed.data.picture_big) ?? boxUrlOf(address, parsed.data.picture)
      const episode = episodeOf(
        positive(parsed.data.season_number),
        positive(parsed.data.episode_number),
      )
      return [
        {
          channel: uuid,
          start: new Date(date * 1000),
          ...(duration === undefined || duration <= 0
            ? {}
            : { stop: new Date((date + duration) * 1000) }),
          titles: texts(title),
          subtitles: texts(sub_title),
          descriptions: texts(desc),
          categories: texts(category_name),
          images: image === undefined ? [] : [image],
          ...(episode === undefined ? {} : { episode }),
        } satisfies TvGuideProgramme,
      ]
    })
  })
}

/** Whether `result` may be a `by_time` answer: channels by uuid, or empty. */
export const isGuideResult = (result: unknown): boolean =>
  result === undefined ||
  objectEntriesSchema.safeParse(result).success ||
  (Array.isArray(result) && result.length === 0)
