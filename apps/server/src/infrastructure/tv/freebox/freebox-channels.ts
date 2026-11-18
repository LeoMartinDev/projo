import type { TvProviderChannel } from '../../../core/tv/provider.ts'
import {
  arraySchema,
  type FreeboxBouquetEntry,
  freeboxBouquetEntrySchema,
  type FreeboxChannel,
  freeboxChannelSchema,
  type FreeboxStream,
  freeboxStreamSchema,
  objectEntriesSchema,
} from './freebox-api.ts'

/** The one group of a Freebox source: the bouquet's name (§29.2). */
export const FREEBOX_GROUP = 'Freebox TV'

/** Stream qualities, best first (§29.2); any other comes after them. */
const qualityRank = ['hd', 'auto', 'sd', 'ld']

const rankOf = (stream: FreeboxStream): number => {
  const rank = qualityRank.indexOf(stream.quality ?? '')
  return rank === -1 ? qualityRank.length : rank
}

const isRtsp = (url: string | undefined): url is string =>
  url !== undefined && URL.canParse(url) && new URL(url).protocol === 'rtsp:'

/** The entry's best `rtsp` URL: HD, else auto, else SD, else LD, else the first. */
export const bestRtspOf = (streams: readonly unknown[]): string | undefined => {
  const usable = streams.flatMap((stream) => {
    const parsed = freeboxStreamSchema.safeParse(stream)
    return parsed.success && isRtsp(parsed.data.rtsp) ? [parsed.data] : []
  })
  // A stable sort: equal ranks keep the box's order.
  const [best] = [...usable].sort((a, b) => rankOf(a) - rankOf(b))
  return best?.rtsp
}

const cleanName = (name: string): string => name.trim().replaceAll(/\s+/gu, ' ')

/**
 * A logo path of the box resolved against its address; kept only on the box's own origin, so a
 * listing never makes the server fetch another host's URL (§29.2).
 */
const logoUrlOf = (address: string, logoUrl: string | undefined): string | undefined => {
  if (logoUrl === undefined || logoUrl.trim() === '' || !URL.canParse(logoUrl, address))
    return undefined
  const url = new URL(logoUrl, address)
  return url.origin === new URL(address).origin ? url.href : undefined
}

const channelsByUuid = (result: unknown): Map<string, FreeboxChannel> => {
  const entries = objectEntriesSchema.safeParse(result)
  const channels = new Map<string, FreeboxChannel>()
  if (!entries.success) return channels
  for (const value of Object.values(entries.data)) {
    const parsed = freeboxChannelSchema.safeParse(value)
    if (parsed.success) channels.set(parsed.data.uuid, parsed.data)
  }
  return channels
}

const bouquetEntries = (result: unknown): FreeboxBouquetEntry[] => {
  const entries = arraySchema.safeParse(result)
  if (!entries.success) return []
  return entries.data.flatMap((value) => {
    const parsed = freeboxBouquetEntrySchema.safeParse(value)
    return parsed.success ? [parsed.data] : []
  })
}

/** `false` when an answer's `result` is not the shape of its endpoint at all. */
export const isChannelsResult = (result: unknown): boolean =>
  objectEntriesSchema.safeParse(result).success
export const isBouquetResult = (result: unknown): boolean => arraySchema.safeParse(result).success

/**
 * The source's channels (§29.2): the `freeboxtv` bouquet joined with `tv/channels` on the uuid,
 * kept when available on the line and holding an `rtsp` stream; one channel per uuid at its
 * lowest number, ordered by number then sub-number. Pure.
 */
export const freeboxChannelsOf = ({
  address,
  channels: channelsResult,
  bouquet: bouquetResult,
}: {
  address: string
  /** `result` of `tv/channels`. */
  channels: unknown
  /** `result` of `tv/bouquets/freeboxtv/channels`. */
  bouquet: unknown
}): TvProviderChannel[] => {
  const channels = channelsByUuid(channelsResult)
  const sorted = bouquetEntries(bouquetResult).sort(
    (a, b) => a.number - b.number || (a.sub_number ?? 0) - (b.sub_number ?? 0),
  )
  const seen = new Set<string>()
  return sorted.flatMap((entry) => {
    if (!entry.available || seen.has(entry.uuid)) return []
    const channel = channels.get(entry.uuid)
    const upstream = bestRtspOf(entry.streams ?? [])
    const name = channel === undefined ? '' : cleanName(channel.name)
    if (channel === undefined || upstream === undefined || name === '') return []
    seen.add(entry.uuid)
    const logoUrl = logoUrlOf(address, channel.logo_url)
    return [
      {
        key: entry.uuid,
        name,
        ...(entry.number > 0 ? { number: entry.number } : {}),
        group: FREEBOX_GROUP,
        ...(logoUrl === undefined ? {} : { logoUrl }),
        upstream: { url: upstream },
        guideKey: entry.uuid,
      } satisfies TvProviderChannel,
    ]
  })
}
