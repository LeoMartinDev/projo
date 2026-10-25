import type { TFunction } from 'i18next'

import type { SourceVersionDto } from '@projo/shared/api/versions'

/** ffprobe `codec_name` → its usual name; acronyms are the same in every language. */
const videoCodecs: Record<string, string> = {
  h264: 'H.264',
  avc1: 'H.264',
  hevc: 'HEVC',
  h265: 'HEVC',
  av1: 'AV1',
  vp9: 'VP9',
  vp8: 'VP8',
  mpeg4: 'MPEG-4',
  mpeg2video: 'MPEG-2',
  vc1: 'VC-1',
}

export const videoCodecLabel = (codec: string): string =>
  videoCodecs[codec.toLowerCase()] ?? codec.toUpperCase()

const dynamicRanges = { sdr: undefined, hdr: 'HDR', dv: 'DV' } as const

/** §8.1: an edition id in the interface language (`editions.<id>`), a tag's text as written. */
export const editionLabel = (
  t: TFunction,
  version: Pick<SourceVersionDto, 'edition' | 'editionName'>,
): string | undefined =>
  version.edition === undefined ? version.editionName : t(`editions.${version.edition}`)

/** §7.7 `2160p HDR HEVC · Version longue`, composed from the codes; `undefined` when nothing is known. */
export const versionLabel = (t: TFunction, version: SourceVersionDto): string | undefined => {
  const technical = [
    version.resolution,
    version.dynamicRange === undefined ? undefined : dynamicRanges[version.dynamicRange],
    version.videoCodec === undefined ? undefined : videoCodecLabel(version.videoCodec),
  ]
    .filter((part) => part !== undefined)
    .join(' ')
  const label = [technical, editionLabel(t, version) ?? '']
    .filter((part) => part !== '')
    .join(' · ')
  return label === '' ? undefined : label
}

/**
 * Labels of the versions of one item, in their order, always distinct (§7.7): a version without
 * a label is "Version 3", two versions with the same label take their number after it
 * ("1080p H.264 · Version 2").
 */
export const versionLabels = (t: TFunction, versions: readonly SourceVersionDto[]): string[] => {
  const labels = versions.map((version) => versionLabel(t, version))
  return labels.map((label, index) => {
    const number = t('versions.number', { number: index + 1 })
    if (label === undefined) return number
    return labels.filter((other) => other === label).length > 1 ? `${label} · ${number}` : label
  })
}
