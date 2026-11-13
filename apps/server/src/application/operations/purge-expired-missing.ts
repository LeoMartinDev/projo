import type { Clock } from '../../core/clock.ts'
import { type MissingSourcePurgeDeps, purgeSources } from './shared/missing-source-purge.ts'

export const MISSING_PURGE_AFTER_MS = 30 * 24 * 60 * 60_000

export const purgeExpiredMissingFactory =
  (deps: MissingSourcePurgeDeps & { clock: Clock; maxAgeMs?: number }) =>
  (): { purged: number } => ({
    purged: purgeSources(
      deps,
      deps.missingSources.listMissingIds({
        missingBefore: new Date(
          deps.clock.now().getTime() - (deps.maxAgeMs ?? MISSING_PURGE_AFTER_MS),
        ),
      }),
    ),
  })

export type PurgeExpiredMissing = ReturnType<typeof purgeExpiredMissingFactory>
