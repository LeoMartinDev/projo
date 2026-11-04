import { z } from 'zod'

export const fsBrowseQuerySchema = z.object({ path: z.string().max(4096).default('/') })
export type FsBrowseQuery = z.infer<typeof fsBrowseQuerySchema>

export const fsDirectoryEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  hidden: z.boolean(),
  symlink: z.boolean(),
})
export type FsDirectoryEntry = z.infer<typeof fsDirectoryEntrySchema>

export const fsBrowseResponseSchema = z.object({
  path: z.string(),
  parent: z.string().optional(),
  entries: z.array(fsDirectoryEntrySchema),
  truncated: z.boolean(),
})
export type FsBrowseResponse = z.infer<typeof fsBrowseResponseSchema>
