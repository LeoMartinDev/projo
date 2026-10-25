import { z } from 'zod'

import { contentRatingTierSchema } from './profiles.ts'

/**
 * §9.1 classification of a movie or a series (seasons and episodes: their series'), as stored:
 * the official `code` of its rating `country` (`TP`, `12` in France; `R`, `PG-13` in the United
 * States…), the library's or the US fallback. `tier`: the §14 age tier it falls in, i.e. the lowest
 * maximum rating of a profile that still shows it (`R` → `18`); absent when the code is not on its
 * country's scale (`NR`, unknown country). `country` is absent on rows enriched before it was
 * stored. The badge is composed by the web from these codes, in the interface language (§13.5).
 */
export const contentRatingDtoSchema = z.object({
  code: z.string(),
  country: z.string().optional(),
  tier: contentRatingTierSchema.optional(),
})
export type ContentRatingDto = z.infer<typeof contentRatingDtoSchema>
