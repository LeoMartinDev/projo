import type { TvChannelDto, TvProgrammeDto } from '@projo/shared/api/tv'

/**
 * What an "On now" card shows (§29.6): the programme's image, else the channel's logo on a
 * neutral fill, else its name. The one place that decides it: a live snapshot comes first here
 * once channels have one.
 */
export type CardImage =
  { kind: 'programme'; url: string } | { kind: 'logo'; url: string } | { kind: 'name' }

export const cardImageOf = (
  channel: Pick<TvChannelDto, 'logoUrl'>,
  programme: Pick<TvProgrammeDto, 'imageUrl'> | undefined,
): CardImage => {
  if (programme?.imageUrl !== undefined) return { kind: 'programme', url: programme.imageUrl }
  if (channel.logoUrl !== undefined) return { kind: 'logo', url: channel.logoUrl }
  return { kind: 'name' }
}
