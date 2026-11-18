import { type TvChannelDto, type TvProgrammeDto, TV_SNAPSHOT_SHOWN_MS } from '@projo/shared/api/tv'

/**
 * What a card of the TV page shows (§29.6): the channel's snapshot under an hour old, else its
 * programme's image, else its logo on a neutral fill, else its name. The one place that decides.
 */
export type CardImage =
  | { kind: 'snapshot'; url: string }
  | { kind: 'programme'; url: string }
  | { kind: 'logo'; url: string }
  | { kind: 'name' }

/** Every image the card may show, best first: a picture that fails to load gives way to the next. */
export const cardImagesOf = (
  channel: Pick<TvChannelDto, 'logoUrl' | 'snapshot'>,
  programme: Pick<TvProgrammeDto, 'imageUrl'> | undefined,
  at: number,
): readonly CardImage[] => {
  const { snapshot, logoUrl } = channel
  const fresh =
    snapshot !== undefined && at - new Date(snapshot.takenAt).getTime() < TV_SNAPSHOT_SHOWN_MS
  return [
    ...(fresh ? [{ kind: 'snapshot', url: snapshot.url } as const] : []),
    ...(programme?.imageUrl === undefined
      ? []
      : [{ kind: 'programme', url: programme.imageUrl } as const]),
    ...(logoUrl === undefined ? [] : [{ kind: 'logo', url: logoUrl } as const]),
    { kind: 'name' },
  ]
}

/** The card's image (§29.6): the first of `cardImagesOf`. */
export const cardImageOf = (
  channel: Pick<TvChannelDto, 'logoUrl' | 'snapshot'>,
  programme: Pick<TvProgrammeDto, 'imageUrl'> | undefined,
  at: number,
): CardImage => cardImagesOf(channel, programme, at)[0] ?? { kind: 'name' }
