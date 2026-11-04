import { z } from 'zod'

import { contentRatingTierSchema } from './profiles.ts'

export const contentRatingDtoSchema = z.object({
  code: z.string(),
  country: z.string().optional(),
  tier: contentRatingTierSchema.optional(),
})
export type ContentRatingDto = z.infer<typeof contentRatingDtoSchema>
