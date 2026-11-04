export { videoCodecLabel } from '@projo/i18n/versions'

const audioCodecs: Record<string, string> = {
  aac: 'AAC',
  ac3: 'Dolby Digital',
  eac3: 'Dolby Digital Plus',
  truehd: 'Dolby TrueHD',
  dts: 'DTS',
  opus: 'Opus',
  flac: 'FLAC',
  mp3: 'MP3',
  vorbis: 'Vorbis',
}

export const audioCodecLabel = (codec: string): string =>
  audioCodecs[codec.toLowerCase()] ?? codec.toUpperCase()

export const resolutionLabel = (width: number | undefined, height: number | undefined) => {
  if (height === undefined) return undefined
  const w = width ?? 0
  if (height >= 2000 || w >= 3800) return '4K'
  if (height >= 1000 || w >= 1900) return '1080p'
  if (height >= 700 || w >= 1260) return '720p'
  return `${height}p`
}

export const channelsLabel = (channels: number | undefined): string | undefined => {
  switch (channels) {
    case undefined:
      return undefined
    case 1:
      return 'mono'
    case 2:
      return 'stereo'
    case 6:
      return '5.1'
    case 8:
      return '7.1'
    default:
      return `${channels} ch`
  }
}

const bibliographic: Record<string, string> = {
  fre: 'fra',
  ger: 'deu',
  dut: 'nld',
  chi: 'zho',
  cze: 'ces',
  gre: 'ell',
  per: 'fas',
  rum: 'ron',
  slo: 'slk',
  alb: 'sqi',
  arm: 'hye',
  baq: 'eus',
  bur: 'mya',
  geo: 'kat',
  ice: 'isl',
  mac: 'mkd',
  may: 'msa',
  wel: 'cym',
}

export const languageName = (code: string | undefined, locale: string): string | undefined => {
  if (code === undefined || code === 'und') return undefined
  const normalized = bibliographic[code.toLowerCase()] ?? code.toLowerCase()
  try {
    const name = new Intl.DisplayNames([locale], { type: 'language', fallback: 'none' }).of(
      normalized,
    )
    return name === undefined ? code : name.charAt(0).toLocaleUpperCase(locale) + name.slice(1)
  } catch {
    return code
  }
}
