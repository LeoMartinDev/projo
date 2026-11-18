import { eq, sql } from 'drizzle-orm'

import type { TvProgrammeImageRepository } from '../../core/tv/programme-image.ts'
import type { Db } from './database.ts'
import { toIso } from './rows.ts'
import { tvChannels, tvProgrammeImages, tvProgrammes } from './schema/tv.ts'
import { firstTwoEndingAfter } from './tv-guide-repository.ts'

/** Programme images (§29.3), once per URL hash. */
export const createSqliteTvProgrammeImageRepository = ({
  db,
}: {
  db: Db
}): TvProgrammeImageRepository => ({
  work: ({ at, retryFailedBefore, refetchBefore }) =>
    db.all<{ key: string; url: string; sourceId: string }>(sql`
      SELECT n.image_key AS key, min(n.image_url) AS url, min(c.source_id) AS sourceId
      FROM ${firstTwoEndingAfter(at)} n
      JOIN ${tvChannels} c ON c.id = n.channel_id
      LEFT JOIN ${tvProgrammeImages} i ON i.key = n.image_key
      WHERE n.image_key IS NOT NULL AND (
        i.key IS NULL
        OR (i.failed_at IS NOT NULL AND i.failed_at < ${toIso(retryFailedBefore)})
        OR (i.failed_at IS NULL AND i.fetched_at < ${toIso(refetchBefore)})
      )
      GROUP BY n.image_key
      ORDER BY n.image_key`),

  record: ({ key, at, path }) => {
    const when = toIso(at)
    db.insert(tvProgrammeImages)
      .values(
        path === undefined
          ? { key, failedAt: when }
          : { key, path, fetchedAt: when, failedAt: null },
      )
      .onConflictDoUpdate({
        target: tvProgrammeImages.key,
        set: path === undefined ? { failedAt: when } : { path, fetchedAt: when, failedAt: null },
      })
      .run()
  },

  pathOf: (key) =>
    db
      .select({ path: tvProgrammeImages.path })
      .from(tvProgrammeImages)
      .where(eq(tvProgrammeImages.key, key))
      .get()?.path ?? undefined,

  purgeUnreferenced: () =>
    db
      .all<{ path: string | null }>(
        sql`
        DELETE FROM ${tvProgrammeImages}
        WHERE NOT EXISTS (
          SELECT 1 FROM ${tvProgrammes} p WHERE p.image_key = ${tvProgrammeImages.key}
        )
        RETURNING path`,
      )
      .flatMap(({ path }) => (path === null ? [] : [path])),
})
