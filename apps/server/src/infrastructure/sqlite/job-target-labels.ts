import { inArray, sql } from 'drizzle-orm'

import { ownTitle } from '../../core/catalog/generic-titles.ts'
import {
  type JobTargetItem,
  type JobTargetLabels,
  type JobTargetName,
  type JobTargetRef,
  jobTargetKey,
} from '../../core/jobs/ports.ts'
import type { Db } from './database.ts'
import { stripNulls } from './rows.ts'
import { items } from './schema/items.ts'
import { libraries, sources } from './schema/libraries.ts'

const idsOf = (targets: readonly JobTargetRef[], kinds: readonly JobTargetRef['kind'][]) => [
  ...new Set(targets.filter((target) => kinds.includes(target.kind)).map((target) => target.id)),
]

/**
 * Names of job targets (§15 "Jobs", "cible"), one query per kind of the page: library name, file
 * name, the version itself; an item by its parts (own title, series, numbers), worded by the web.
 */
export const createSqliteJobTargetLabels = ({ db }: { db: Db }): JobTargetLabels => ({
  labelsOf: (targets) => {
    const names = new Map<string, JobTargetName>()

    const libraryIds = idsOf(targets, ['library'])
    if (libraryIds.length > 0) {
      for (const row of db
        .select({ id: libraries.id, name: libraries.name })
        .from(libraries)
        .where(inArray(libraries.id, libraryIds))
        .all())
        names.set(jobTargetKey({ kind: 'library', id: row.id }), { label: row.name })
    }

    const sourceIds = idsOf(targets, ['source'])
    if (sourceIds.length > 0) {
      for (const row of db
        .select({ id: sources.id, relativePath: sources.relativePath })
        .from(sources)
        .where(inArray(sources.id, sourceIds))
        .all())
        names.set(jobTargetKey({ kind: 'source', id: row.id }), {
          label: row.relativePath.split('/').at(-1) ?? row.relativePath,
        })
    }

    const itemIds = idsOf(targets, ['item', 'season'])
    if (itemIds.length > 0) {
      const rows = db
        .select({
          id: items.id,
          kind: items.kind,
          title: items.title,
          seasonNumber: items.seasonNumber,
          episodeNumber: items.episodeNumber,
          parentTitle: sql<
            string | null
          >`(SELECT p.title FROM items p WHERE p.id = "items"."parent_id")`,
          grandParentTitle: sql<
            string | null
          >`(SELECT g.title FROM items p CROSS JOIN items g ON g.id = p.parent_id WHERE p.id = "items"."parent_id")`,
        })
        .from(items)
        .where(inArray(items.id, itemIds))
        .all()
      for (const row of rows) {
        const { id, kind, title, seasonNumber, episodeNumber, parentTitle, grandParentTitle } =
          stripNulls(row)
        const own = ownTitle({ kind, title, seasonNumber, episodeNumber })
        const seriesTitle =
          kind === 'episode' ? grandParentTitle : kind === 'season' ? parentTitle : undefined
        const item: JobTargetItem = {
          kind,
          ...(own === undefined ? {} : { title: own }),
          ...(seriesTitle === undefined ? {} : { seriesTitle }),
          ...(seasonNumber === undefined ? {} : { seasonNumber }),
          ...(episodeNumber === undefined ? {} : { episodeNumber }),
        }
        names.set(jobTargetKey({ kind: kind === 'season' ? 'season' : 'item', id }), { item })
        // A season id may come as an `item` target too (`refresh_metadata` of a season).
        if (kind === 'season') names.set(jobTargetKey({ kind: 'item', id }), { item })
      }
    }

    for (const target of targets)
      if (target.kind === 'version') names.set(jobTargetKey(target), { label: target.id })

    return names
  },
})
