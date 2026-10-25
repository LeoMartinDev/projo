import { z } from 'zod'

/** Schemas for `/api/v1/admin/fs/browse` (§17.2, §20 explorateur de fichiers). */

export const fsBrowseQuerySchema = z.object({ path: z.string().max(4096).default('/') })
export type FsBrowseQuery = z.infer<typeof fsBrowseQuerySchema>

export const fsDirectoryEntrySchema = z.object({
  name: z.string(),
  /** Absolute path to pass back as `?path=` to open it. */
  path: z.string(),
  /** Name starts with `.` (the web may hide those by default). */
  hidden: z.boolean(),
  /** A symbolic link resolving to a directory inside the browsed one (§20: never outside). */
  symlink: z.boolean(),
})
export type FsDirectoryEntry = z.infer<typeof fsDirectoryEntrySchema>

/** Directories only, sorted by name. Read only: nothing is ever created or modified. */
export const fsBrowseResponseSchema = z.object({
  /** Normalized absolute path of the listed directory. */
  path: z.string(),
  /** Absent at `/`. */
  parent: z.string().optional(),
  entries: z.array(fsDirectoryEntrySchema),
  /** True when the listing was cut at the server limit. */
  truncated: z.boolean(),
})
export type FsBrowseResponse = z.infer<typeof fsBrowseResponseSchema>
