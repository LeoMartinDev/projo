import { z } from 'zod'

import { itemPageSchema } from './catalog.ts'
import { paginationQuerySchema } from './common.ts'

/**
 * "My list" (§13.4, §17.2): movies and series. `GET /watchlist` is a page like Movies / Shows,
 * last added first; `GET|POST|DELETE /watchlist/:itemId` read, add (idempotent), remove.
 */
export const watchlistQuerySchema = paginationQuerySchema
export type WatchlistQuery = z.infer<typeof watchlistQuerySchema>

export const watchlistPageSchema = itemPageSchema
export type WatchlistPage = z.infer<typeof watchlistPageSchema>

export const watchlistStatusSchema = z.object({
  itemId: z.string(),
  inWatchlist: z.boolean(),
  addedAt: z.string().optional(),
})
export type WatchlistStatus = z.infer<typeof watchlistStatusSchema>
