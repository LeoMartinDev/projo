// The site's photos, resized and re-encoded ahead of Vite by scripts/images.ts (Bun.Image) into
// generated/ (not committed): the pages get each photo as an <img srcset> filled from here
// (pageContext's `photo`), the homepage wall imports its tiles from generated/wall/.
// Sources are the originals in design/ and @projo/design/backdrops/; a change here or to a
// source regenerates its files on the next dev start or build.

export type Photo = { source: string; widths: readonly number[]; quality: number }

const backdrop = (name: string) => `../../packages/design/backdrops/${name}.webp`
const sample = (name: string) => `../../design/sample-library/assets/${name}.webp`
const thumbnail = (name: string) => `../../design/sample-library/thumbnails/${name}.webp`
const websiteAsset = (name: string) => `../../design/website-assets/${name}.webp`

// Widths cover a phone (≈ 400 px at 2–3×, often cropped to a portrait box) up to a 2× desktop.
const ladder = [640, 960, 1280, 1600] as const

/** Photos shown by the pages, keyed by the name the templates use ({{ photo.<name>.srcset }}). */
export const photos = {
  mountains: { source: backdrop('mountains'), widths: ladder, quality: 78 },
  lighthouse: { source: backdrop('lighthouse'), widths: ladder, quality: 78 },
  city: { source: backdrop('city'), widths: ladder, quality: 78 },
  darkFantasy: {
    source: websiteAsset('dark-fantasy-landscape-v1'),
    widths: [640, 960, 1280],
    quality: 78,
  },
  lanternes: { source: sample('lanternes'), widths: [640, 960, 1280], quality: 78 },
  lanternesAtelier: { source: sample('lanternes-atelier'), widths: ladder, quality: 78 },
  privateCinema: {
    source: websiteAsset('private-cinema-natural-v1'),
    widths: [960, 1440, 1920, 2560],
    quality: 76,
  },
} satisfies Record<string, Photo>
export type PhotoName = keyof typeof photos

/** The wall behind the homepage title: small tiles under a dark veil, one 640 px file each. */
export const wallPhotos = {
  nord: thumbnail('nord'),
  lanternesAtelier: thumbnail('lanternes-atelier'),
  marees: thumbnail('marees'),
  dunes: backdrop('dunes'),
  minuit: thumbnail('minuit'),
  lanternes: thumbnail('lanternes'),
  orbite: thumbnail('orbite'),
  ocean: backdrop('ocean'),
  ferry: thumbnail('ferry'),
  lanternesPont: thumbnail('lanternes-pont'),
  tilleuls: thumbnail('tilleuls'),
  mountains: backdrop('mountains'),
  city: backdrop('city'),
} as const
export const wallTile = { width: 640, quality: 68 } as const

/** Generated file of a photo at a width, relative to the app root. */
export const photoFile = (name: string, width: number) => `generated/photos/${name}.w${width}.webp`
/** Generated file of a wall tile, relative to the app root. */
export const wallFile = (name: string) => `generated/wall/${name}.webp`

/** `src` and `srcset` of a photo for the pages: absolute URLs Vite resolves from the app root. */
export const photoSources = (name: PhotoName) => {
  const { widths } = photos[name]
  const url = (width: number) => `/${photoFile(name, width)}`
  return {
    src: url(widths[Math.min(1, widths.length - 1)] ?? 0),
    srcset: widths.map((width) => `${url(width)} ${width}w`).join(', '),
  }
}
