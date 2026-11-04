import { readFileSync } from 'node:fs'

import { z } from 'zod'

const manifestSchema = z.object({ version: z.string().min(1) })

export const readManifestVersion = (manifestFile: string): string | undefined => {
  try {
    const parsed = manifestSchema.safeParse(JSON.parse(readFileSync(manifestFile, 'utf8')))
    return parsed.success ? parsed.data.version : undefined
  } catch {
    return undefined
  }
}
