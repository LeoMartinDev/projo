import { type MissingSourcePurgeDeps, purgeSources } from './shared/missing-source-purge.ts'

export const purgeAllMissingSourcesFactory =
  (deps: MissingSourcePurgeDeps) =>
  ({ libraryId }: { libraryId?: string }): { purged: number } => ({
    purged: purgeSources(
      deps,
      deps.missingSources.listMissingIds(libraryId === undefined ? {} : { libraryId }),
    ),
  })

export type PurgeAllMissingSources = ReturnType<typeof purgeAllMissingSourcesFactory>
