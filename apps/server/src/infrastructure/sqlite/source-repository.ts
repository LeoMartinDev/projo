import { and, count, desc, eq, inArray, lt, sql } from 'drizzle-orm'

import { ownTitle } from '../../core/catalog/generic-titles.ts'
import type {
  ExternalSubtitleRow,
  LinkedItemLabel,
  NewSource,
  PendingBreakdown,
  PendingReason,
  PendingSourceView,
  Source,
  SourceCounts,
  SourcePatch,
  SourceRepository,
  SourceSnapshot,
} from '../../core/source/source.ts'
import type { IdGenerator } from '../../core/ids.ts'
import type { Db } from './database.ts'
import { fromIso, stripNulls, toIso, toNullable } from './rows.ts'
import {
  libraries,
  libraryRoots,
  sources,
  sourceItems,
  sourceSubtitles,
} from './schema/libraries.ts'
import { items } from './schema/items.ts'
import { readMediaProbe, readParsedName } from './source-columns.ts'

type SourceRow = typeof sources.$inferSelect
type SourceInsert = typeof sources.$inferInsert

const optionalDate = <K extends string>(key: K, value: string | undefined) =>
  (value === undefined ? {} : { [key]: fromIso(value) }) as { [P in K]?: Date }

const optional = <K extends string, V>(key: K, value: V | undefined) =>
  (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }

const toSnapshot = (row: SourceRow): SourceSnapshot => {
  const r = stripNulls(row)
  return {
    id: r.id,
    libraryId: r.libraryId,
    rootId: r.rootId,
    relativePath: r.relativePath,
    state: r.state,
    sizeBytes: r.sizeBytes,
    mtimeMs: r.mtime,
    classification: r.classification,
    parsed: readParsedName(r.parsed),
    matchState: r.matchState,
    ...optional('pendingReason', r.pendingReason),
    ...optional('inode', r.inode),
    ...optionalDate('readyAt', r.readyAt),
    ...optional('signature', r.signature),
    ...optional('stackGroupId', r.stackGroupId),
    ...optional('partIndex', r.partIndex),
  }
}

const toSource = (row: SourceRow): Source => {
  const r = stripNulls(row)
  return {
    ...toSnapshot(row),
    extension: r.extension,
    discoveredAt: fromIso(r.discoveredAt),
    ...optionalDate('pendingSince', r.pendingSince),
    ...optionalDate('unchangedSince', r.unchangedSince),
    ...optionalDate('stableSince', r.stableSince),
    ...optionalDate('missingSince', r.missingSince),
    ...(r.probe === undefined ? {} : { probe: readMediaProbe(r.probe) }),
    ...optional('reviewReason', r.reviewReason),
  }
}

const isoOrNull = (value: Date | undefined): string | null =>
  value === undefined ? null : toIso(value)

/** `SourcePatch` → Drizzle `set`. A present key with `undefined` becomes NULL. */
const toSet = (patch: SourcePatch): Partial<SourceInsert> => {
  const set: Partial<SourceInsert> = {}
  if ('rootId' in patch && patch.rootId !== undefined) set.rootId = patch.rootId
  if ('relativePath' in patch && patch.relativePath !== undefined)
    set.relativePath = patch.relativePath
  if ('extension' in patch && patch.extension !== undefined) set.extension = patch.extension
  if ('state' in patch && patch.state !== undefined) set.state = patch.state
  if ('pendingReason' in patch) set.pendingReason = toNullable(patch.pendingReason)
  if ('sizeBytes' in patch && patch.sizeBytes !== undefined) set.sizeBytes = patch.sizeBytes
  if ('mtimeMs' in patch && patch.mtimeMs !== undefined) set.mtime = patch.mtimeMs
  if ('inode' in patch) set.inode = toNullable(patch.inode)
  if ('pendingSince' in patch) set.pendingSince = isoOrNull(patch.pendingSince)
  if ('unchangedSince' in patch) set.unchangedSince = isoOrNull(patch.unchangedSince)
  if ('stableSince' in patch) set.stableSince = isoOrNull(patch.stableSince)
  if ('readyAt' in patch) set.readyAt = isoOrNull(patch.readyAt)
  if ('missingSince' in patch) set.missingSince = isoOrNull(patch.missingSince)
  if ('probe' in patch) set.probe = toNullable(patch.probe)
  if ('signature' in patch) set.signature = toNullable(patch.signature)
  if ('classification' in patch && patch.classification !== undefined)
    set.classification = patch.classification
  if ('parsed' in patch && patch.parsed !== undefined) set.parsed = patch.parsed
  if ('matchState' in patch && patch.matchState !== undefined) set.matchState = patch.matchState
  if ('reviewReason' in patch) set.reviewReason = toNullable(patch.reviewReason)
  if ('stackGroupId' in patch) set.stackGroupId = toNullable(patch.stackGroupId)
  if ('partIndex' in patch) set.partIndex = toNullable(patch.partIndex)
  return set
}

const toInsert = (source: NewSource): SourceInsert => ({
  id: source.id,
  libraryId: source.libraryId,
  rootId: source.rootId,
  relativePath: source.relativePath,
  extension: source.extension,
  state: 'pending',
  pendingReason: 'growing',
  sizeBytes: source.sizeBytes,
  mtime: source.mtimeMs,
  inode: toNullable(source.inode),
  discoveredAt: toIso(source.discoveredAt),
  pendingSince: toIso(source.discoveredAt),
  unchangedSince: toIso(source.discoveredAt),
  classification: source.classification,
  parsed: source.parsed,
  matchState: source.matchState,
  reviewReason: toNullable(source.reviewReason),
})

const joinPath = (root: string, relative: string): string =>
  root === '/' ? `/${relative}` : `${root}/${relative}`

const INSERT_CHUNK = 500

/** Titles of linked items ("attached item", §15), episodes with their series. */
const itemLabels = (db: Db, itemIds: string[]): Map<string, LinkedItemLabel> => {
  if (itemIds.length === 0) return new Map()
  const rows = db
    .select({
      id: items.id,
      kind: items.kind,
      title: items.title,
      seasonNumber: items.seasonNumber,
      episodeNumber: items.episodeNumber,
      seriesTitle: sql<
        string | null
      >`(SELECT sr.title FROM items sn CROSS JOIN items sr ON sr.id = sn.parent_id WHERE sn.id = "items"."parent_id")`,
    })
    .from(items)
    .where(inArray(items.id, itemIds))
    .all()
  return new Map(
    rows.map((row) => {
      const { id, kind, title, seasonNumber, episodeNumber, seriesTitle } = stripNulls(row)
      const own = ownTitle({ kind, title, seasonNumber, episodeNumber })
      const label: LinkedItemLabel = {
        id,
        kind,
        ...(own === undefined ? {} : { title: own }),
        ...(kind === 'episode' && seriesTitle !== undefined ? { seriesTitle } : {}),
        ...(seasonNumber === undefined ? {} : { seasonNumber }),
        ...(episodeNumber === undefined ? {} : { episodeNumber }),
      }
      return [id, label] as const
    }),
  )
}

export const createSqliteSourceRepository = ({
  db,
  ids,
}: {
  db: Db
  ids: IdGenerator
}): SourceRepository => ({
  listSnapshots: (libraryId) =>
    db.select().from(sources).where(eq(sources.libraryId, libraryId)).all().map(toSnapshot),

  findById: (id) => {
    const row = db.select().from(sources).where(eq(sources.id, id)).get()
    return row === undefined ? undefined : toSource(row)
  },

  absolutePathOf: (id) => {
    const row = db
      .select({ root: libraryRoots.path, relativePath: sources.relativePath })
      .from(sources)
      .innerJoin(libraryRoots, eq(libraryRoots.id, sources.rootId))
      .where(eq(sources.id, id))
      .get()
    return row === undefined ? undefined : joinPath(row.root, row.relativePath)
  },

  applyChanges: ({ inserts, patches }) => {
    db.transaction((tx) => {
      // Moves first free their old paths; a move onto a path freed in the same scan is then safe.
      for (const { id, patch } of patches) {
        const set = toSet(patch)
        if (Object.keys(set).length > 0) tx.update(sources).set(set).where(eq(sources.id, id)).run()
      }
      for (let i = 0; i < inserts.length; i += INSERT_CHUNK) {
        tx.insert(sources)
          .values(inserts.slice(i, i + INSERT_CHUNK).map(toInsert))
          .run()
      }
    })
  },

  patch: (id, patch) => {
    const set = toSet(patch)
    if (Object.keys(set).length > 0) db.update(sources).set(set).where(eq(sources.id, id)).run()
  },

  listPending: () =>
    db
      .select({
        id: sources.id,
        libraryId: sources.libraryId,
        rootPath: libraryRoots.path,
        relativePath: sources.relativePath,
        pendingReason: sources.pendingReason,
        sizeBytes: sources.sizeBytes,
        mtime: sources.mtime,
        pendingSince: sources.pendingSince,
        unchangedSince: sources.unchangedSince,
        stableSince: sources.stableSince,
        quietPeriodSeconds: libraries.quietPeriodSeconds,
      })
      .from(sources)
      .innerJoin(libraryRoots, eq(libraryRoots.id, sources.rootId))
      .innerJoin(libraries, eq(libraries.id, sources.libraryId))
      .where(and(eq(sources.state, 'pending'), eq(libraryRoots.state, 'ok')))
      .all()
      .map((row): PendingSourceView => {
        const r = stripNulls(row)
        return {
          id: r.id,
          libraryId: r.libraryId,
          rootPath: r.rootPath,
          relativePath: r.relativePath,
          pendingReason: (r.pendingReason ?? 'growing') as PendingReason,
          sizeBytes: r.sizeBytes,
          mtimeMs: r.mtime,
          quietPeriodSeconds: r.quietPeriodSeconds,
          ...optionalDate('pendingSince', r.pendingSince),
          ...optionalDate('unchangedSince', r.unchangedSince),
          ...optionalDate('stableSince', r.stableSince),
        }
      }),

  countPending: () =>
    db
      .select({ count: sql<number>`count(*)` })
      .from(sources)
      .where(eq(sources.state, 'pending'))
      .get()?.count ?? 0,

  countsByLibrary: (libraryId) => {
    const counts: SourceCounts = { pending: 0, ready: 0, missing: 0, rejected: 0 }
    const rows = db
      .select({ state: sources.state, count: sql<number>`count(*)` })
      .from(sources)
      .where(eq(sources.libraryId, libraryId))
      .groupBy(sources.state)
      .all()
    for (const row of rows) counts[row.state] = row.count
    return counts
  },

  pendingBreakdownByLibrary: (libraryId) => {
    // Same reading as `watch_pending` / `decideStability`: a NULL reason is `growing`.
    const growing = sql`coalesce(${sources.pendingReason}, 'growing') = 'growing'`
    const waiting = sql`${growing} and ${sources.stableSince} is null`
    const row = db
      .select({
        waiting: sql<number>`coalesce(sum(case when ${waiting} then 1 else 0 end), 0)`,
        verifying: sql<number>`coalesce(sum(case when ${growing} and ${sources.stableSince} is not null then 1 else 0 end), 0)`,
        failed: sql<number>`coalesce(sum(case when ${growing} then 0 else 1 end), 0)`,
        earliestUnchangedSince: sql<
          string | null
        >`min(case when ${waiting} then ${sources.unchangedSince} end)`,
      })
      .from(sources)
      .innerJoin(
        libraryRoots,
        and(eq(libraryRoots.id, sources.rootId), eq(libraryRoots.state, 'ok')),
      )
      .where(and(eq(sources.libraryId, libraryId), eq(sources.state, 'pending')))
      .get()
    const breakdown: PendingBreakdown = {
      waiting: row?.waiting ?? 0,
      verifying: row?.verifying ?? 0,
      failed: row?.failed ?? 0,
    }
    const earliest = row?.earliestUnchangedSince ?? undefined
    return earliest === undefined
      ? breakdown
      : { ...breakdown, earliestUnchangedSince: fromIso(earliest) }
  },

  page: ({ libraryId, state, matchState, cursor, limit }) => {
    const filters = [
      libraryId === undefined ? undefined : eq(sources.libraryId, libraryId),
      state === undefined ? undefined : eq(sources.state, state),
      matchState === undefined ? undefined : eq(sources.matchState, matchState),
    ]
    const total =
      db
        .select({ total: count() })
        .from(sources)
        .where(and(...filters))
        .get()?.total ?? 0
    const rows = db
      .select({ source: sources, rootPath: libraryRoots.path })
      .from(sources)
      .innerJoin(libraryRoots, eq(libraryRoots.id, sources.rootId))
      .where(and(...filters, cursor === undefined ? undefined : lt(sources.id, cursor)))
      .orderBy(desc(sources.id))
      .limit(limit + 1)
      .all()
    const pageRows = rows.slice(0, limit)
    const pageIds = pageRows.map((row) => row.source.id)
    const links =
      pageIds.length === 0
        ? []
        : db.select().from(sourceItems).where(inArray(sourceItems.sourceId, pageIds)).all()
    const itemIdsBySource = new Map<string, string[]>()
    for (const link of links) {
      itemIdsBySource.set(link.sourceId, [
        ...(itemIdsBySource.get(link.sourceId) ?? []),
        link.itemId,
      ])
    }
    const labels = itemLabels(db, [...new Set(links.map((link) => link.itemId))])
    const last = pageRows.at(-1)
    return {
      total,
      items: pageRows.map((row) => {
        const itemIds = itemIdsBySource.get(row.source.id) ?? []
        return {
          ...toSource(row.source),
          rootPath: row.rootPath,
          itemIds,
          items: itemIds.flatMap((id) => {
            const label = labels.get(id)
            return label === undefined ? [] : [label]
          }),
        }
      }),
      ...(rows.length > limit && last !== undefined ? { nextCursor: last.source.id } : {}),
    }
  },

  externalSubtitlesByLibrary: (libraryId) => {
    const rows = db
      .select({ subtitle: sourceSubtitles })
      .from(sourceSubtitles)
      .innerJoin(sources, eq(sources.id, sourceSubtitles.sourceId))
      .where(and(eq(sources.libraryId, libraryId), eq(sourceSubtitles.kind, 'external')))
      .all()
    const grouped = new Map<string, ExternalSubtitleRow[]>()
    for (const { subtitle } of rows) {
      const s = stripNulls(subtitle)
      const row: ExternalSubtitleRow = {
        path: s.path ?? '',
        forced: s.forced,
        sdh: s.sdh,
        isDefault: s.isDefault,
        format: s.format,
        ...optional('language', s.language),
        ...optional('title', s.title),
      }
      grouped.set(s.sourceId, [...(grouped.get(s.sourceId) ?? []), row])
    }
    return grouped
  },

  replaceExternalSubtitles: (sourceId, rows) => {
    db.transaction((tx) => {
      tx.delete(sourceSubtitles)
        .where(and(eq(sourceSubtitles.sourceId, sourceId), eq(sourceSubtitles.kind, 'external')))
        .run()
      for (const row of rows) {
        tx.insert(sourceSubtitles)
          .values({
            id: ids.next(),
            sourceId,
            kind: 'external',
            path: row.path,
            language: toNullable(row.language),
            forced: row.forced,
            sdh: row.sdh,
            isDefault: row.isDefault,
            format: row.format,
            title: toNullable(row.title),
          })
          .run()
      }
    })
  },

  replaceEmbeddedSubtitles: (sourceId, rows) => {
    db.transaction((tx) => {
      tx.delete(sourceSubtitles)
        .where(and(eq(sourceSubtitles.sourceId, sourceId), eq(sourceSubtitles.kind, 'embedded')))
        .run()
      for (const row of rows) {
        tx.insert(sourceSubtitles)
          .values({
            id: ids.next(),
            sourceId,
            kind: 'embedded',
            streamIndex: row.streamIndex,
            language: toNullable(row.language),
            forced: row.forced,
            sdh: row.sdh,
            isDefault: row.isDefault,
            format: row.format,
            title: toNullable(row.title),
          })
          .run()
      }
    })
  },
})
