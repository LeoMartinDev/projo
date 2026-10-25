import { eq, sql } from 'drizzle-orm'

import type { ImageSlot } from '../../core/metadata/enrichment.ts'
import type { ImageRepository, StoredImage } from '../../core/metadata/ports.ts'
import type { Db } from './database.ts'
import { stripNulls, toNullable } from './rows.ts'
import { images, items, people } from './schema/items.ts'

const slotColumn = {
  poster: items.posterImageId,
  backdrop: items.backdropImageId,
  logo: items.logoImageId,
  still: items.stillImageId,
} as const

const slotKey = {
  poster: 'posterImageId',
  backdrop: 'backdropImageId',
  logo: 'logoImageId',
  still: 'stillImageId',
} as const satisfies Record<ImageSlot, keyof typeof items.$inferInsert>

const toStoredImage = (row: typeof images.$inferSelect): StoredImage => stripNulls(row)

/**
 * §6.3 visibility of the item `alias` (a ready source on it or on one of its episodes), the
 * same rule as the catalog: an image is served only when such an item uses it (§20).
 */
const visibleItem = (alias: string) =>
  sql.raw(`EXISTS (
    SELECT 1 FROM source_items si JOIN sources s ON s.id = si.source_id
    WHERE s.state = 'ready' AND (
      si.item_id = ${alias}.id
      OR si.item_id IN (SELECT e.id FROM items e WHERE e.parent_id = ${alias}.id)
      OR si.item_id IN (
        SELECT e.id FROM items e JOIN items se ON e.parent_id = se.id WHERE se.parent_id = ${alias}.id)
    ))`)

/** `images` rows and the image columns of `items` and `people` (§6.3, §9.1). */
export const createSqliteImageRepository = ({ db }: { db: Db }): ImageRepository => ({
  findById: (id) => {
    const row = db.select().from(images).where(eq(images.id, id)).get()
    return row === undefined ? undefined : toStoredImage(row)
  },

  itemImage: ({ itemId, slot }) => {
    const row = db
      .select({ imageId: images.id, tmdbPath: images.tmdbPath, origin: images.origin })
      .from(items)
      .innerJoin(images, eq(images.id, slotColumn[slot]))
      .where(eq(items.id, itemId))
      .get()
    return row === undefined ? undefined : stripNulls(row)
  },

  insert: (image) => {
    db.insert(images)
      .values({
        id: image.id,
        kind: image.kind,
        origin: image.origin,
        tmdbPath: toNullable(image.tmdbPath),
        localPath: image.localPath,
        width: image.width,
        height: image.height,
        language: toNullable(image.language),
      })
      .run()
  },

  setItemImage: ({ itemId, slot, imageId }) => {
    db.update(items)
      .set({ [slotKey[slot]]: imageId })
      .where(eq(items.id, itemId))
      .run()
  },

  setPersonImage: ({ personId, imageId }) => {
    db.update(people).set({ profileImageId: imageId }).where(eq(people.id, personId)).run()
  },

  deleteIfUnused: (id) => {
    const used = db.$client
      .query(
        `SELECT 1 FROM items WHERE ?1 IN (poster_image_id, backdrop_image_id, logo_image_id, still_image_id)
         UNION ALL SELECT 1 FROM people WHERE profile_image_id = ?1
         UNION ALL SELECT 1 FROM item_overrides
           WHERE field IN ('poster_image_id', 'backdrop_image_id') AND value = json_quote(?1)
         LIMIT 1`,
      )
      .get(id)
    if (used !== null) return undefined
    const row = db.select().from(images).where(eq(images.id, id)).get()
    if (row === undefined) return undefined
    db.delete(images).where(eq(images.id, id)).run()
    return toStoredImage(row)
  },

  findServable: (id) => {
    const row = db
      .select()
      .from(images)
      .where(
        sql`${images.id} = ${id} AND (
          EXISTS (SELECT 1 FROM items i
            WHERE ${images.id} IN (i.poster_image_id, i.backdrop_image_id, i.logo_image_id, i.still_image_id)
              AND ${visibleItem('i')})
          OR EXISTS (SELECT 1 FROM people p JOIN item_people ip ON ip.person_id = p.id
            JOIN items i ON i.id = ip.item_id
            WHERE p.profile_image_id = ${images.id} AND ${visibleItem('i')}))`,
      )
      .get()
    return row === undefined ? undefined : toStoredImage(row)
  },
})
