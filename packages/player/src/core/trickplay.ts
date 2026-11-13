import type { TrickplayIndexDto } from '@projo/shared/api/playback'

export type Thumbnail = {
  url: string
  x: number
  y: number
  width: number
  height: number
  sheetWidth: number
  sheetHeight: number
}

export const sheetUrl = (indexUrl: string, sheet: number): string => {
  const [path = '', query] = indexUrl.split('?')
  const base = path.slice(0, path.lastIndexOf('/') + 1)
  return `${base}${sheet}.jpg${query === undefined ? '' : `?${query}`}`
}

export const sheetUrls = (indexUrl: string, index: TrickplayIndexDto): string[] =>
  index.sheets.map((sheet) => sheetUrl(indexUrl, sheet))

const nearestTime = (times: readonly number[], seconds: number, last: number): number => {
  let nearest = 0
  for (let position = 1; position <= Math.min(last, times.length - 1); position++) {
    const time = times[position] ?? Number.POSITIVE_INFINITY
    if (Math.abs(time - seconds) < Math.abs((times[nearest] ?? 0) - seconds)) nearest = position
  }
  return nearest
}

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
  const last = Math.min(lastBySheets, lastByDuration)
  const position =
    index.times === undefined || index.times.length === 0
      ? Math.min(Math.max(0, Math.round(Math.max(0, seconds) / index.interval)), last)
      : nearestTime(index.times, seconds, last)
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

export const displayScale = (thumbnail: Pick<Thumbnail, 'width'>, maxWidth: number) =>
  thumbnail.width > 0 ? Math.min(1, maxWidth / thumbnail.width) : 1
