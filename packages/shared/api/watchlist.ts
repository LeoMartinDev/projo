import { z } from 'zod'

import { itemPageSchema } from './catalog.ts'
import { paginationQuerySchema } from './common.ts'

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
