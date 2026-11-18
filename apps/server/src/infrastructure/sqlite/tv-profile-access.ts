import { eq } from 'drizzle-orm'

import type { TvProfileAccess } from '../../core/tv/viewer.ts'
import type { Db } from './database.ts'
import { profiles } from './schema/accounts.ts'

/** A profile's Live TV switch (§29.6), read on each request: a change applies at once. */
export const createSqliteTvProfileAccess = ({ db }: { db: Db }): TvProfileAccess => ({
  hasLiveTv: (profileId) =>
    db.select({ liveTv: profiles.liveTv }).from(profiles).where(eq(profiles.id, profileId)).get()
      ?.liveTv === true,
})
