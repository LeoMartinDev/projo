import { asc, eq, inArray, sql } from 'drizzle-orm'

import { rootErrorReasonSchema } from '@projo/shared/api/libraries'

import type { Library, LibraryRepository, LibraryRoot } from '../../core/library/library.ts'
import type { Db } from './database.ts'
import { fromIso, stripNulls, toIso, toNullable } from './rows.ts'
import { libraries, libraryRoots } from './schema/libraries.ts'

type LibraryRow = typeof libraries.$inferSelect
type RootRow = typeof libraryRoots.$inferSelect

const toRoot = (row: RootRow): LibraryRoot => {
  const { lastScanAt, ...rest } = stripNulls(row)
  // Versions before reason codes stored an English message: dropped, the next scan rewrites it.
  const lastError = rootErrorReasonSchema.safeParse(rest.lastError).data
  return {
    id: rest.id,
    libraryId: rest.libraryId,
    path: rest.path,
    state: rest.state,
    lastFileCount: rest.lastFileCount,
    ...(lastScanAt === undefined ? {} : { lastScanAt: fromIso(lastScanAt) }),
    ...(lastError === undefined ? {} : { lastError }),
  }
}

const toLibrary = (row: LibraryRow, roots: LibraryRoot[]): Library => {
  const { metadataLanguage, createdAt, ...rest } = stripNulls(row)
  return {
    id: rest.id,
    name: rest.name,
    hint: rest.hint,
    scanIntervalMinutes: rest.scanIntervalMinutes,
    watchEnabled: rest.watchEnabled,
    quietPeriodSeconds: rest.quietPeriodSeconds,
    detectSegments: rest.detectSegments,
    preExtractSubtitles: rest.preExtractSubtitles,
    trickplayEnabled: rest.trickplayEnabled,
    ratingCountry: rest.ratingCountry,
    createdAt: fromIso(createdAt),
    ...(metadataLanguage === undefined ? {} : { metadataLanguage }),
    roots,
  }
}

export const createSqliteLibraryRepository = ({ db }: { db: Db }): LibraryRepository => {
  const rootsOf = (libraryIds: string[]): Map<string, LibraryRoot[]> => {
    const grouped = new Map<string, LibraryRoot[]>()
    if (libraryIds.length === 0) return grouped
    const rows = db
      .select()
      .from(libraryRoots)
      .where(inArray(libraryRoots.libraryId, libraryIds))
      .orderBy(asc(libraryRoots.path))
      .all()
    for (const row of rows) {
      grouped.set(row.libraryId, [...(grouped.get(row.libraryId) ?? []), toRoot(row)])
    }
    return grouped
  }

  const withRoots = (rows: LibraryRow[]): Library[] => {
    const roots = rootsOf(rows.map((row) => row.id))
    return rows.map((row) => toLibrary(row, roots.get(row.id) ?? []))
  }

  const findById = (id: string): Library | undefined => {
    const row = db.select().from(libraries).where(eq(libraries.id, id)).get()
    return row === undefined ? undefined : withRoots([row])[0]
  }

  const mustFind = (id: string): Library => {
    const library = findById(id)
    if (library === undefined) throw new Error(`library not found: ${id}`)
    return library
  }

  return {
    list: () => withRoots(db.select().from(libraries).orderBy(asc(libraries.name)).all()),
    findById,
    findByName: (name) => {
      const row = db
        .select()
        .from(libraries)
        .where(sql`lower(${libraries.name}) = lower(${name})`)
        .get()
      return row === undefined ? undefined : withRoots([row])[0]
    },
    listRoots: () => db.select().from(libraryRoots).all().map(toRoot),
    create: (library) =>
      db.transaction((tx) => {
        tx.insert(libraries)
          .values({
            id: library.id,
            name: library.name,
            hint: library.hint,
            scanIntervalMinutes: library.scanIntervalMinutes,
            watchEnabled: library.watchEnabled,
            quietPeriodSeconds: library.quietPeriodSeconds,
            detectSegments: library.detectSegments,
            preExtractSubtitles: library.preExtractSubtitles,
            trickplayEnabled: library.trickplayEnabled,
            metadataLanguage: toNullable(library.metadataLanguage),
            ratingCountry: library.ratingCountry,
            createdAt: toIso(library.createdAt),
          })
          .run()
        for (const root of library.roots) {
          tx.insert(libraryRoots)
            .values({ id: root.id, libraryId: library.id, path: root.path })
            .run()
        }
        return mustFind(library.id)
      }),
    update: ({ id, changes, roots }) =>
      db.transaction((tx) => {
        const { metadataLanguage, ...rest } = changes
        const set = {
          ...rest,
          ...('metadataLanguage' in changes
            ? { metadataLanguage: toNullable(metadataLanguage) }
            : {}),
        }
        if (Object.keys(set).length > 0) {
          tx.update(libraries).set(set).where(eq(libraries.id, id)).run()
        }
        if (roots !== undefined) {
          if (roots.remove.length > 0) {
            tx.delete(libraryRoots).where(inArray(libraryRoots.id, roots.remove)).run()
          }
          for (const root of roots.add) {
            tx.insert(libraryRoots).values({ id: root.id, libraryId: id, path: root.path }).run()
          }
        }
        return mustFind(id)
      }),
    delete: (id) => {
      db.delete(libraries).where(eq(libraries.id, id)).run()
    },
    markRootScanned: ({ rootId, at, fileCount }) => {
      db.update(libraryRoots)
        .set({ state: 'ok', lastScanAt: toIso(at), lastFileCount: fileCount, lastError: null })
        .where(eq(libraryRoots.id, rootId))
        .run()
    },
    markRootUnreachable: ({ rootId, at, reason }) => {
      db.update(libraryRoots)
        .set({ state: 'unreachable', lastScanAt: toIso(at), lastError: reason })
        .where(eq(libraryRoots.id, rootId))
        .run()
    },
  }
}
