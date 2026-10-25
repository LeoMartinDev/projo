import { and, asc, eq, sql } from 'drizzle-orm'

import type { PlayableSource } from '../../core/catalog/catalog.ts'
import { sourceVersionOf } from '../../core/media/version.ts'
import { groupVersions, rankVersions } from '../../core/playback/versions.ts'
import type { FingerprintCatalog, FingerprintEpisode } from '../../core/segments/fingerprint.ts'
import { readMediaInfo } from '../playback/probe-reader.ts'
import type { Db } from './database.ts'
import { items } from './schema/items.ts'
import { libraries, libraryRoots, sourceItems, sources } from './schema/libraries.ts'
import { readParsedEdition } from './source-columns.ts'

const joinPath = (root: string, relative: string): string =>
  `${root.replace(/\/+$/, '')}/${relative.replace(/^\/+/, '')}`

type Row = {
  itemId: string
  source: typeof sources.$inferSelect
  rootPath: string
  rootState: 'ok' | 'unreachable'
  detectSegments: boolean
}

const toPlayableSource = ({ source, rootPath, rootState }: Row): PlayableSource => {
  const media = readMediaInfo(source.probe)
  return {
    id: source.id,
    state: source.state,
    libraryId: source.libraryId,
    path: joinPath(rootPath, source.relativePath),
    rootReachable: rootState === 'ok',
    extension: source.extension,
    sizeBytes: source.sizeBytes,
    mtime: source.mtime,
    version: sourceVersionOf(media?.video[0], readParsedEdition(source.parsed)),
    ...(source.stackGroupId === null ? {} : { stackGroupId: source.stackGroupId }),
    ...(source.partIndex === null ? {} : { partIndex: source.partIndex }),
    ...(media === undefined ? {} : { media }),
  }
}

/**
 * The episodes of a season for `fingerprint_season` (§12.3): those with a ready source in a
 * `detect_segments` library (the chain's rule). Per episode, the version playback plays
 * (`groupVersions` + `rankVersions` over every ready source, in `listReadySources` order), so
 * that fingerprint positions are on the timeline the player uses; the episode is left out when a
 * part of that version is on an unreachable root, or lacks a probed duration or audio.
 */
export const createSqliteFingerprintCatalog = ({ db }: { db: Db }): FingerprintCatalog => ({
  listSeasonEpisodes: (seasonId) => {
    const rows: Row[] = db
      .select({
        itemId: items.id,
        source: sources,
        rootPath: libraryRoots.path,
        rootState: libraryRoots.state,
        detectSegments: libraries.detectSegments,
      })
      .from(items)
      .innerJoin(sourceItems, eq(sourceItems.itemId, items.id))
      .innerJoin(sources, eq(sources.id, sourceItems.sourceId))
      .innerJoin(libraries, eq(libraries.id, sources.libraryId))
      .innerJoin(libraryRoots, eq(libraryRoots.id, sources.rootId))
      .where(
        and(
          eq(items.parentId, seasonId),
          sql`+${items.kind} = 'episode'`,
          sql`+${sources.state} = 'ready'`,
        ),
      )
      .orderBy(
        sql`coalesce(${items.episodeNumber}, 1e9)`,
        asc(items.id),
        sql`coalesce(${sources.partIndex}, 0)`,
        sql`${sources.sizeBytes} DESC`,
        asc(sources.id),
      )
      .all()

    const byItem = new Map<string, Row[]>()
    for (const row of rows) byItem.set(row.itemId, [...(byItem.get(row.itemId) ?? []), row])

    return [...byItem.entries()].flatMap(([itemId, itemRows]): FingerprintEpisode[] => {
      if (!itemRows.some((row) => row.detectSegments)) return []
      const [version] = rankVersions(groupVersions(itemRows.map(toPlayableSource)))
      if (version === undefined) return []
      const playable = version.parts.every(
        ({ rootReachable, media }) =>
          rootReachable && (media?.durationMs ?? 0) > 0 && (media?.audio.length ?? 0) > 0,
      )
      if (!playable) return []
      return [
        {
          itemId,
          fileKey: version.key,
          parts: version.parts.map(({ path, media }) => ({
            path,
            durationMs: media?.durationMs ?? 0,
          })),
        },
      ]
    })
  },

  isChainPending: (seasonId) =>
    db.all<{ found: number }>(sql`SELECT 1 AS found FROM jobs j
      WHERE j.type = 'fetch_segments' AND j.state IN ('queued', 'running')
        AND json_extract(j.payload, '$.itemId') IN (
          SELECT e.id FROM items e WHERE e.parent_id = ${seasonId} AND +e.kind = 'episode')
      LIMIT 1`).length > 0,
})
