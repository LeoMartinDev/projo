import { sessions, accounts, profiles } from '../../src/infrastructure/sqlite/schema/accounts.ts'
import { images, itemPeople, items, people } from '../../src/infrastructure/sqlite/schema/items.ts'
import {
  libraries,
  libraryRoots,
  sourceItems,
  sources,
} from '../../src/infrastructure/sqlite/schema/libraries.ts'
import { playbackProgress, watchlist } from '../../src/infrastructure/sqlite/schema/playback.ts'
import type { Db } from '../../src/infrastructure/sqlite/database.ts'

/**
 * Direct inserts for catalog / playback / progress tests (the scanner writes these rows in the
 * app). Every helper returns the inserted id; `seed*` helpers build small graphs.
 */

const at = '2026-01-01T00:00:00.000Z'

export const insertAccount = (db: Db, id = 'account-1') => {
  db.insert(accounts)
    .values({ id, username: id, passwordHash: 'x', role: 'admin', createdAt: at })
    .run()
  return id
}

export const insertAuthSession = (db: Db, accountId: string, id = `session-of-${accountId}`) => {
  db.insert(sessions)
    .values({
      id,
      accountId,
      kind: 'cookie',
      tokenHash: `hash-${id}`,
      deviceName: 'test',
      userAgent: 'test',
      createdAt: at,
      lastSeenAt: at,
      expiresAt: '2099-01-01T00:00:00.000Z',
    })
    .run()
  return id
}

export const insertProfile = (db: Db, accountId: string, id = `profile-of-${accountId}`) => {
  db.insert(profiles)
    .values({
      id,
      accountId,
      name: id,
      avatarColor: 'blue',
      audioLanguage: 'fr',
      subtitleLanguage: 'fr',
      createdAt: at,
    })
    .run()
  return id
}

/** A library with one root at `rootPath`. */
export const insertLibrary = (
  db: Db,
  { id = 'library-1', rootPath = '/media', ratingCountry = 'FR' } = {},
) => {
  db.insert(libraries).values({ id, name: id, ratingCountry, createdAt: at }).run()
  db.insert(libraryRoots)
    .values({ id: `${id}-root`, libraryId: id, path: rootPath })
    .run()
  return { libraryId: id, rootId: `${id}-root` }
}

type ItemInput = Partial<typeof items.$inferInsert> & {
  id: string
  kind: 'movie' | 'series' | 'season' | 'episode'
}

export const insertItem = (db: Db, input: ItemInput) => {
  db.insert(items)
    .values({
      title: input.id,
      sortTitle: input.id,
      createdAt: at,
      updatedAt: at,
      ...input,
    })
    .run()
  return input.id
}

type SourceInput = Partial<typeof sources.$inferInsert> & {
  id: string
  itemId?: string
  libraryId?: string
  rootId?: string
}

export const insertSource = (db: Db, { itemId, ...input }: SourceInput) => {
  db.insert(sources)
    .values({
      libraryId: 'library-1',
      rootId: 'library-1-root',
      relativePath: `${input.id}.mkv`,
      extension: 'mkv',
      state: 'ready',
      sizeBytes: 1000,
      mtime: 1,
      discoveredAt: at,
      ...input,
    })
    .run()
  if (itemId !== undefined) db.insert(sourceItems).values({ sourceId: input.id, itemId }).run()
  return input.id
}

/** Account + auth session + profile: what the auth middleware would resolve. */
export const seedViewer = (db: Db, accountId = 'account-1') => {
  insertAccount(db, accountId)
  return {
    accountId,
    authSessionId: insertAuthSession(db, accountId),
    profileId: insertProfile(db, accountId),
  }
}

export const insertImage = (
  db: Db,
  id: string,
  kind: 'poster' | 'backdrop' | 'logo' | 'still' = 'poster',
) => {
  db.insert(images)
    .values({ id, kind, origin: 'tmdb', localPath: `/data/images/${id}.jpg`, width: 1, height: 1 })
    .run()
  return id
}

/** A person credited on an item. */
export const insertCredit = (
  db: Db,
  {
    itemId,
    personId,
    name = personId,
    role = 'cast',
    character,
    order = 0,
    profileImageId,
  }: {
    itemId: string
    personId: string
    name?: string
    role?: 'cast' | 'director' | 'writer'
    character?: string
    order?: number
    profileImageId?: string
  },
) => {
  db.insert(people)
    .values({
      id: personId,
      tmdbId: [...personId].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) % 1e9, 7),
      name,
      ...(profileImageId === undefined ? {} : { profileImageId }),
    })
    .onConflictDoNothing()
    .run()
  db.insert(itemPeople)
    .values({ itemId, personId, role, order, ...(character === undefined ? {} : { character }) })
    .run()
}

/** A `playback_progress` row (ratio of a 1 h duration). */
export const insertProgress = (
  db: Db,
  {
    profileId,
    itemId,
    ratio = 0,
    watched = false,
    lastPlayedAt = at,
    hidden = false,
  }: {
    profileId: string
    itemId: string
    ratio?: number
    watched?: boolean
    lastPlayedAt?: string
    hidden?: boolean
  },
) => {
  db.insert(playbackProgress)
    .values({
      profileId,
      itemId,
      positionMs: Math.round(ratio * 3_600_000),
      durationMs: 3_600_000,
      watched,
      ...(watched ? { watchedAt: lastPlayedAt } : {}),
      playCount: watched ? 1 : 0,
      lastPlayedAt,
      hiddenFromContinue: hidden,
    })
    .run()
}

export const insertWatchlist = (db: Db, profileId: string, itemId: string, addedAt = at) => {
  db.insert(watchlist).values({ profileId, itemId, addedAt }).run()
}

/**
 * A series with ready episodes: `episodes` is `[season, episode]` pairs; ids are
 * `<id>-s<n>` for seasons and `<id>-s<n>e<m>` for episodes, sources `f-<episode id>`.
 */
export const seedSeries = (
  db: Db,
  {
    id,
    episodes,
    libraryId = 'library-1',
    ...extra
  }: Omit<ItemInput, 'kind'> & { episodes: [number, number][]; libraryId?: string },
) => {
  insertItem(db, { id, kind: 'series', ...extra })
  for (const season of new Set(episodes.map(([number]) => number))) {
    insertItem(db, {
      id: `${id}-s${season}`,
      kind: 'season',
      parentId: id,
      seasonNumber: season,
      sortTitle: String(season).padStart(4, '0'),
    })
  }
  for (const [season, number] of episodes) {
    const episodeId = `${id}-s${season}e${number}`
    insertItem(db, {
      id: episodeId,
      kind: 'episode',
      parentId: `${id}-s${season}`,
      seasonNumber: season,
      episodeNumber: number,
    })
    insertSource(db, {
      id: `f-${episodeId}`,
      itemId: episodeId,
      libraryId,
      rootId: `${libraryId}-root`,
    })
  }
  return id
}
