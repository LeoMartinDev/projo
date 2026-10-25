import type { TrickplayIndexDto } from '@projo/shared/api/playback'

/**
 * Timeline thumbnails (§10.5): sprites of `columns × rows` thumbnails of `width × height`, one
 * every `interval` seconds of the stream, on sheets `/trickplay/:sourceId/<n>.jpg` next to the
 * index. Pure: which sheet, and where in it, for a stream position.
 */
export type Thumbnail = {
  url: string
  /** Offset of the thumbnail in its sheet, in sprite pixels. */
  x: number
  y: number
  width: number
  height: number
  /** Size of the whole sheet, in sprite pixels. */
  sheetWidth: number
  sheetHeight: number
}

/** `/api/v1/trickplay/src/index.json` → `/api/v1/trickplay/src/3.jpg`. */
export const sheetUrl = (indexUrl: string, sheet: number): string => {
  const [path = '', query] = indexUrl.split('?')
  const base = path.slice(0, path.lastIndexOf('/') + 1)
  return `${base}${sheet}.jpg${query === undefined ? '' : `?${query}`}`
}

export const sheetUrls = (indexUrl: string, index: TrickplayIndexDto): string[] =>
  index.sheets.map((sheet) => sheetUrl(indexUrl, sheet))

/**
 * Thumbnail of the stream second `seconds`, `undefined` when the index has no sheet. Thumbnail `i`
 * is the picture at `i × interval` exactly, so the one shown is the nearest to `seconds` (not the
 * one before: at 19 s it would show the scene of 10 s). Clamped to the last thumbnail of the
 * stream (`streamDurationS`) and of the last sheet.
 */
export const thumbnailAt = (
  index: TrickplayIndexDto,
  indexUrl: string,
  seconds: number,
  streamDurationS?: number,
): Thumbnail | undefined => {
  const perSheet = index.columns * index.rows
  if (index.sheets.length === 0 || perSheet <= 0 || !Number.isFinite(seconds)) return undefined
  const lastBySheets = index.sheets.length * perSheet - 1
  const lastByDuration =
    streamDurationS === undefined || streamDurationS <= 0
      ? lastBySheets
      : Math.max(0, Math.ceil(streamDurationS / index.interval) - 1)
  const position = Math.min(
    Math.max(0, Math.round(Math.max(0, seconds) / index.interval)),
    lastBySheets,
    lastByDuration,
  )
  const sheet = index.sheets[Math.floor(position / perSheet)]
  if (sheet === undefined) return undefined
  const within = position % perSheet
  return {
    url: sheetUrl(indexUrl, sheet),
    x: (within % index.columns) * index.width,
    y: Math.floor(within / index.columns) * index.height,
    width: index.width,
    height: index.height,
    sheetWidth: index.columns * index.width,
    sheetHeight: index.rows * index.height,
  }
}

/** Shown size of a thumbnail: `maxWidth` wide at most, aspect kept. */
export const displayScale = (thumbnail: Pick<Thumbnail, 'width'>, maxWidth: number) =>
  thumbnail.width > 0 ? Math.min(1, maxWidth / thumbnail.width) : 1
