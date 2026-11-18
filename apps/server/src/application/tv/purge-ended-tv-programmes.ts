import type { Clock } from '../../core/clock.ts'
import type { TvGuideRepository } from '../../core/tv/guide.ts'

/** Deletes the programmes that have ended (§29.3), every hour; returns how many. */
export const purgeEndedTvProgrammesFactory =
  ({ guide, clock }: { guide: Pick<TvGuideRepository, 'deleteEnded'>; clock: Clock }) =>
  (): number =>
    guide.deleteEnded(clock.now())

export type PurgeEndedTvProgrammes = ReturnType<typeof purgeEndedTvProgrammesFactory>
