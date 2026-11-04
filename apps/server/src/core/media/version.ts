import type { DynamicRange, EditionId, Resolution } from '@projo/shared/api/versions'

export type { DynamicRange, EditionId, Resolution }

export type SourceVersion = {
  resolution?: Resolution
  dynamicRange?: DynamicRange
  videoCodec?: string
  edition?: EditionId
  editionName?: string
}

export const resolutionOf = (
  width: number | undefined,
  height: number | undefined,
): Resolution | undefined => {
  if (width === undefined && height === undefined) return undefined
  const w = width ?? 0
  const h = height ?? 0
  if (w >= 3200 || h >= 1800) return '2160p'
  if (w >= 1700 || h >= 1000) return '1080p'
  if (w >= 1100 || h >= 700) return '720p'
  return 'SD'
}

type MainVideo = {
  codec: string
  width?: number
  height?: number
  dynamicRange?: DynamicRange
}

export const sourceVersionOf = (
  video: MainVideo | undefined,
  parsed: { edition?: EditionId | undefined; editionName?: string | undefined },
): SourceVersion => {
  const resolution = resolutionOf(video?.width, video?.height)
  const codec = video?.codec.toLowerCase()
  return {
    ...(resolution === undefined ? {} : { resolution }),
    ...(video?.dynamicRange === undefined ? {} : { dynamicRange: video.dynamicRange }),
    ...(codec === undefined || codec === '' || codec === 'unknown' ? {} : { videoCodec: codec }),
    ...(parsed.edition !== undefined
      ? { edition: parsed.edition }
      : parsed.editionName === undefined
        ? {}
        : { editionName: parsed.editionName }),
  }
}
