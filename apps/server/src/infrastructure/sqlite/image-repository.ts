import { eq } from 'drizzle-orm'

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

  localPaths: () =>
    db
      .select({ localPath: images.localPath })
      .from(images)
      .all()
      .map((row) => row.localPath),

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
})
