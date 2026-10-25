import { sql } from 'drizzle-orm'
import { z } from 'zod'

import { genreIdSchema } from '@projo/shared/api/genres'

import type { CategoryTitle, HomeCategoryQueries } from '../../core/home/categories.ts'
import { visible } from './catalog-sql.ts'
import type { Db } from './database.ts'
import { fromIso, parseJsonColumn } from './rows.ts'

/**
 * §13.3 category rows: the visible movies and series with a genre, in one query, grouped and
 * ranked by the core (`countCategories`, `categoryRows`). Measured on 20 000 items: about 7 ms,
 * where counting and ranking with window functions in SQL took 30 to 40 ms.
 */

const genresSchema = z.array(genreIdSchema)

export const createSqliteHomeCategoryQueries = ({ db }: { db: Db }): HomeCategoryQueries => ({
  listTitles: ({ scope }) =>
    db
      .all<{ id: string; genres: string; originalLanguage: string | null; added: string }>(
        sql`SELECT items.id AS id, items.genres AS genres,
            items.original_language AS originalLanguage,
            coalesce(items.added_at, items.created_at) AS added
          FROM items
          WHERE items.kind IN ('movie', 'series') AND items.genres <> '[]' AND ${visible(scope)}`,
      )
      .map(({ id, genres, originalLanguage, added }): CategoryTitle => ({
        id,
        genres: parseJsonColumn(genresSchema, JSON.parse(genres), 'items.genres'),
        ...(originalLanguage === null ? {} : { originalLanguage }),
        addedAt: fromIso(added),
      })),
})
