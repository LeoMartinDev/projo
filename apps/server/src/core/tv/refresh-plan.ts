import {
  type TvChannel,
  type TvChannelUpdate,
  type TvGroup,
  type TvRefreshPlan,
  TV_MISSING_CHANNEL_RETENTION_MS,
} from './channel.ts'
import type { TvProviderChannel } from './provider.ts'

const sameUpstream = (a: TvChannel['upstream'], b: TvChannel['upstream']): boolean =>
  a.url === b.url && a.userAgent === b.userAgent && a.referrer === b.referrer

const unchanged = (channel: TvChannel, update: TvChannelUpdate): boolean =>
  channel.missingSince === undefined &&
  channel.name === update.name &&
  channel.number === update.number &&
  channel.groupId === update.groupId &&
  channel.position === update.position &&
  channel.guideKey === update.guideKey &&
  channel.logoUrl === update.logoUrl &&
  sameUpstream(channel.upstream, update.upstream)

/**
 * What a successful refresh changes (§29.2): channels matched by key keep their id and
 * `enabled`; new ones take their group's flag; absent ones are marked missing, then deleted
 * after 7 days; groups are matched by name and deleted once they hold no channel. A key listed
 * twice keeps its first entry.
 */
export const planTvRefresh = ({
  sourceId,
  groups,
  channels,
  listing,
  now,
  newId,
}: {
  sourceId: string
  groups: readonly TvGroup[]
  channels: readonly TvChannel[]
  listing: readonly TvProviderChannel[]
  now: Date
  newId: () => string
}): TvRefreshPlan => {
  const groupsByName = new Map(groups.map((group) => [group.name, group]))
  const channelsByKey = new Map(channels.map((channel) => [channel.key, channel]))

  const listedGroups = new Map<string, TvGroup>()
  const groupInserts: TvGroup[] = []
  const groupUpdates: { id: string; position: number }[] = []
  const groupFor = (name: string): TvGroup => {
    const listed = listedGroups.get(name)
    if (listed !== undefined) return listed
    const position = listedGroups.size
    const existing = groupsByName.get(name)
    const group: TvGroup = existing ?? {
      id: newId(),
      sourceId,
      name,
      enabled: false,
      position,
    }
    if (existing === undefined) groupInserts.push(group)
    else if (existing.position !== position) groupUpdates.push({ id: existing.id, position })
    listedGroups.set(name, group)
    return group
  }

  const seen = new Set<string>()
  const inserts: TvChannel[] = []
  const updates: TvChannelUpdate[] = []
  for (const entry of listing) {
    if (seen.has(entry.key)) continue
    seen.add(entry.key)
    const group = groupFor(entry.group)
    const position = seen.size - 1
    const existing = channelsByKey.get(entry.key)
    if (existing === undefined) {
      inserts.push({
        id: newId(),
        sourceId,
        key: entry.key,
        name: entry.name,
        ...(entry.number === undefined ? {} : { number: entry.number }),
        groupId: group.id,
        position,
        upstream: entry.upstream,
        ...(entry.guideKey === undefined ? {} : { guideKey: entry.guideKey }),
        ...(entry.logoUrl === undefined ? {} : { logoUrl: entry.logoUrl }),
        enabled: group.enabled,
        createdAt: now,
      })
      continue
    }
    const update: TvChannelUpdate = {
      id: existing.id,
      name: entry.name,
      number: entry.number,
      groupId: group.id,
      position,
      upstream: entry.upstream,
      guideKey: entry.guideKey,
      logoUrl: entry.logoUrl,
    }
    if (!unchanged(existing, update)) updates.push(update)
  }

  const deleteBefore = now.getTime() - TV_MISSING_CHANNEL_RETENTION_MS
  const markMissing: string[] = []
  const deleted: string[] = []
  const keptGroupIds = new Set([...listedGroups.values()].map((group) => group.id))
  for (const channel of channels) {
    if (seen.has(channel.key)) continue
    if (channel.missingSince === undefined) markMissing.push(channel.id)
    else if (channel.missingSince.getTime() <= deleteBefore) {
      deleted.push(channel.id)
      continue
    }
    keptGroupIds.add(channel.groupId)
  }

  return {
    sourceId,
    groups: {
      insert: groupInserts,
      update: groupUpdates,
      delete: groups.filter((group) => !keptGroupIds.has(group.id)).map((group) => group.id),
    },
    channels: {
      insert: inserts,
      update: updates,
      markMissing: { ids: markMissing, at: now },
      delete: deleted,
    },
  }
}
