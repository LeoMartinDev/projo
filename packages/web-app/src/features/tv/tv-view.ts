import { readStored, writeStored } from '../../shared/storage/local-store.ts'

/** The TV page's views (§29.6): "Featured" (the "On now" rows and sections) and the guide grid. */
export const tvViews = ['featured', 'guide'] as const
export type TvView = (typeof tvViews)[number]

const storageKey = 'projo.tv.view'

export const parseTvView = (value: unknown): TvView | undefined =>
  tvViews.find((view) => view === value)

/** The view last shown on this device; "Featured" at first or without storage. */
export const rememberedTvView = (): TvView => parseTvView(readStored(storageKey)) ?? 'featured'

export const rememberTvView = (view: TvView) => writeStored(storageKey, view)
