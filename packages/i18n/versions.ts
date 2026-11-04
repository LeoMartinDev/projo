import type { TFunction } from 'i18next'

import type { SourceVersionDto } from '@projo/shared/api/versions'

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

export const editionLabel = (
  t: TFunction,
  version: Pick<SourceVersionDto, 'edition' | 'editionName'>,
): string | undefined =>
  version.edition === undefined ? version.editionName : t(`editions.${version.edition}`)

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

export const versionLabels = (t: TFunction, versions: readonly SourceVersionDto[]): string[] => {
  const labels = versions.map((version) => versionLabel(t, version))
  return labels.map((label, index) => {
    const number = t('versions.number', { number: index + 1 })
    if (label === undefined) return number
    return labels.filter((other) => other === label).length > 1 ? `${label} · ${number}` : label
  })
}
