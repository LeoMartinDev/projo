import type { DynamicRange, EditionId, Resolution } from '@projo/shared/api/versions'

export type { DynamicRange, EditionId, Resolution }

/**
 * §7.7: what tells the versions of an item apart, as codes. Derived on read from `sources.probe`
 * (main video stream) and `sources.parsed` (edition); the label is composed by the web.
 */
export type SourceVersion = {
  resolution?: Resolution
  dynamicRange?: DynamicRange
  /** ffprobe `codec_name`, lowercase (`hevc`, `h264`, `av1`…). */
  videoCodec?: string
  edition?: EditionId
  /** Text of a `{edition-…}` tag; exclusive with `edition`. */
  editionName?: string
}

/** Width first so that scope formats (1920x800) keep their class. */
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

/** The version of a file from its main video stream (`undefined` before the probe) and its parse. */
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
