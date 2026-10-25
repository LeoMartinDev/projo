import { asc, count, eq, inArray } from 'drizzle-orm'

import { type ContentRatingTier, contentRatingTierSchema } from '@projo/shared/api/profiles'

import type { Profile, ProfileRepository } from '../../core/profile/profile.ts'
import type { Db } from './database.ts'
import { fromIso, stripNulls, toIso, toNullable } from './rows.ts'
import { profileLibraries, profiles } from './schema/accounts.ts'
import { libraries } from './schema/libraries.ts'

type ProfileRow = typeof profiles.$inferSelect

/** `libraryIds` comes from `profile_libraries`; empty for `all` whatever the table holds. */
/** A stored tier this version does not know fails closed: the strictest tier. */
const toTier = (value: string): ContentRatingTier => {
  const parsed = contentRatingTierSchema.safeParse(value)
  return parsed.success ? parsed.data : '0'
}

export const toProfile = (row: ProfileRow, libraryIds: readonly string[] = []): Profile => {
  const { createdAt, maxContentRating, ...rest } = stripNulls(row)
  return {
    ...rest,
    ...(maxContentRating === undefined ? {} : { maxContentRating: toTier(maxContentRating) }),
    libraryIds: rest.libraryAccess === 'selected' ? [...libraryIds].sort() : [],
    createdAt: fromIso(createdAt),
  }
}

export const toProfileRow = (profile: Profile): ProfileRow => ({
  id: profile.id,
  accountId: profile.accountId,
  name: profile.name,
  avatarColor: profile.avatarColor,
  pinHash: toNullable(profile.pinHash),
  maxContentRating: toNullable(profile.maxContentRating),
  libraryAccess: profile.libraryAccess,
  uiLocale: profile.uiLocale,
  audioLanguage: profile.audioLanguage,
  subtitleLanguage: profile.subtitleLanguage,
  subtitleMode: profile.subtitleMode,
  animeOriginalAudio: profile.animeOriginalAudio,
  autoplayNext: profile.autoplayNext,
  autoSkipIntro: profile.autoSkipIntro,
  autoSkipCredits: profile.autoSkipCredits,
  createdAt: toIso(profile.createdAt),
})

type Writer = Pick<Db, 'insert' | 'delete'>

const writeLibraries = (db: Writer, profile: Profile) => {
  db.delete(profileLibraries).where(eq(profileLibraries.profileId, profile.id)).run()
  if (profile.libraryAccess !== 'selected' || profile.libraryIds.length === 0) return
  db.insert(profileLibraries)
    .values(profile.libraryIds.map((libraryId) => ({ profileId: profile.id, libraryId })))
    .onConflictDoNothing()
    .run()
}

/** Inserts a profile and its libraries (inside the caller's transaction when there is one). */
export const insertProfile = (db: Writer, profile: Profile) => {
  db.insert(profiles).values(toProfileRow(profile)).run()
  writeLibraries(db, profile)
}

const libraryIdsByProfile = (db: Db, profileIds: readonly string[]) => {
  const byProfile = new Map<string, string[]>()
  if (profileIds.length === 0) return byProfile
  for (const row of db
    .select()
    .from(profileLibraries)
    .where(inArray(profileLibraries.profileId, [...profileIds]))
    .all()) {
    byProfile.set(row.profileId, [...(byProfile.get(row.profileId) ?? []), row.libraryId])
  }
  return byProfile
}

/** Profiles with their libraries, in the order of `rows`. */
export const toProfiles = (db: Db, rows: readonly ProfileRow[]): Profile[] => {
  const byProfile = libraryIdsByProfile(
    db,
    rows.filter((row) => row.libraryAccess === 'selected').map((row) => row.id),
  )
  return rows.map((row) => toProfile(row, byProfile.get(row.id)))
}

export const createSqliteProfileRepository = ({ db }: { db: Db }): ProfileRepository => ({
  findById: (id) => {
    const row = db.select().from(profiles).where(eq(profiles.id, id)).get()
    return row && toProfiles(db, [row])[0]
  },
  listByAccount: (accountId) =>
    toProfiles(
      db,
      db
        .select()
        .from(profiles)
        .where(eq(profiles.accountId, accountId))
        .orderBy(asc(profiles.createdAt), asc(profiles.id))
        .all(),
    ),
  create: (profile, { maxPerAccount }) =>
    db.transaction((tx) => {
      const existing = tx
        .select({ count: count() })
        .from(profiles)
        .where(eq(profiles.accountId, profile.accountId))
        .get()
      if ((existing?.count ?? 0) >= maxPerAccount) return false
      insertProfile(tx, profile)
      return true
    }),
  update: (profile) => {
    db.transaction((tx) => {
      const {
        id: _id,
        accountId: _accountId,
        createdAt: _createdAt,
        ...columns
      } = toProfileRow(profile)
      tx.update(profiles).set(columns).where(eq(profiles.id, profile.id)).run()
      writeLibraries(tx, profile)
    })
  },
  delete: (id) => {
    db.delete(profiles).where(eq(profiles.id, id)).run()
  },
  unknownLibraryIds: (ids) => {
    if (ids.length === 0) return []
    const known = new Set(
      db
        .select({ id: libraries.id })
        .from(libraries)
        .where(inArray(libraries.id, [...ids]))
        .all()
        .map((row) => row.id),
    )
    return [...new Set(ids)].filter((id) => !known.has(id))
  },
})
