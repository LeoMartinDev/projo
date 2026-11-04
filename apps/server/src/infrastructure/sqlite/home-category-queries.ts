import { sql } from 'drizzle-orm'
import { z } from 'zod'

import { genreIdSchema } from '@projo/shared/api/genres'

import type { CategoryTitle, HomeCategoryQueries } from '../../core/home/categories.ts'
import { visible } from './catalog-sql.ts'
import type { Db } from './database.ts'
import { fromIso, parseJsonColumn } from './rows.ts'

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
