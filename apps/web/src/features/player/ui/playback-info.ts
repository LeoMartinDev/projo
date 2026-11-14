import type { TFunction } from 'i18next'

import type { PlaybackInfoLive } from '@projo/player/application/playback-info'
import type { PlaybackSessionDto } from '@projo/shared/api/playback'

import { audioCodecLabel, channelsLabel, videoCodecLabel } from '../../item/media-labels.ts'
import { formatBytes } from '../../../shared/format/format.ts'

export type InfoRow = { label: string; value: string; warn?: boolean }
export type InfoGroup = { title: string; rows: InfoRow[] }

const joined = (parts: readonly (string | undefined)[]) =>
  parts.filter((part) => part !== undefined && part !== '').join(' · ')

const decimal = (value: number, locale: string, digits = 1) =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value)

export const formatBitrate = (bitsPerSecond: number, locale: string): string =>
  bitsPerSecond >= 1_000_000
    ? `${decimal(bitsPerSecond / 1_000_000, locale)} Mb/s`
    : `${decimal(bitsPerSecond / 1000, locale, 0)} kb/s`

const size = (width: number | undefined, height: number | undefined) =>
  width === undefined || height === undefined ? undefined : `${width}×${height}`

const qualityHeights: Record<string, number> = { '1080p': 1080, '720p': 720, '480p': 480 }

/**
 * The playback info (§10.7) as label/value rows: what the session decided, the file it plays,
 * what the server sends, and what the engine sees. Values stay technical (codec names, sizes).
 */
export const playbackInfoGroups = ({
  t,
  locale,
  session,
  live,
  audioIndex,
  subtitleId,
  bufferAheadS,
}: {
  t: TFunction
  locale: string
  session: PlaybackSessionDto
  live: PlaybackInfoLive | undefined
  audioIndex: number | undefined
  subtitleId: string | undefined
  bufferAheadS: number | undefined
}): InfoGroup[] => {
  const { media, mode } = session
  const video = media.video
  const audio = session.audioTracks.find((track) => track.index === audioIndex)
  const subtitle = session.subtitleTracks.find((track) => track.id === subtitleId)
  const transcode = live?.transcode
  const engine = live?.engine
  const reasons = (session.transcodeReasons ?? []).map((reason) =>
    t(`player.info.reasons.${reason}`),
  )
  const outputHeight =
    session.quality === 'original' ? video?.height : qualityHeights[session.quality]

  const sourceRows: InfoRow[] = [
    {
      label: t('player.info.container'),
      value: joined([
        media.container.toUpperCase(),
        formatBytes(media.sizeBytes, locale),
        media.bitrate === undefined ? undefined : formatBitrate(media.bitrate, locale),
      ]),
    },
    ...(video === undefined
      ? []
      : [
          {
            label: t('player.info.video'),
            value: joined([
              video.profile === undefined
                ? videoCodecLabel(video.codec)
                : `${videoCodecLabel(video.codec)} ${video.profile}`,
              size(video.width, video.height),
              video.pixelFormat,
              video.dynamicRange === undefined || video.dynamicRange === 'sdr'
                ? undefined
                : t(`player.info.dynamicRange.${video.dynamicRange}`),
            ]),
          },
        ]),
    ...(audio === undefined
      ? []
      : [
          {
            label: t('player.info.audio'),
            value: joined([
              audioCodecLabel(audio.codec),
              channelsLabel(audio.channels),
              audio.language,
            ]),
          },
        ]),
    {
      label: t('player.info.subtitles'),
      value:
        subtitle === undefined
          ? t('player.menu.off')
          : joined([
              subtitle.format.toUpperCase(),
              subtitle.language,
              t(`player.info.subtitleDelivery.${subtitle.delivery}`),
            ]),
    },
  ]

  const encoding =
    transcode?.acceleration === undefined
      ? undefined
      : joined([
          t(`player.info.acceleration.${transcode.acceleration}`),
          transcode.preset,
          transcode.speed === undefined ? undefined : `×${decimal(transcode.speed, locale, 2)}`,
        ])
  const streamRows: InfoRow[] = [
    {
      label: t('player.info.video'),
      value:
        mode === 'direct'
          ? t('player.info.asIs')
          : mode === 'hls_remux'
            ? t('player.info.copy')
            : joined(['H.264', outputHeight === undefined ? undefined : `${outputHeight}p`]),
    },
    ...(audio === undefined
      ? []
      : [
          {
            label: t('player.info.audio'),
            value:
              mode === 'direct' || audio.delivery === 'direct'
                ? t('player.info.asIs')
                : audio.delivery === 'copy'
                  ? t('player.info.copy')
                  : 'AAC',
          },
        ]),
    ...(mode === 'direct'
      ? []
      : [
          {
            label: 'ffmpeg',
            value:
              transcode === undefined
                ? '—'
                : joined([
                    t(transcode.running ? 'player.info.running' : 'player.info.idle'),
                    encoding,
                  ]),
            warn: transcode?.speed !== undefined && transcode.speed < 1,
          },
        ]),
    ...(transcode?.hdr === undefined
      ? []
      : [
          {
            label: 'HDR',
            value: t(`player.info.hdr.${transcode.hdr}`),
            warn: transcode.hdr === 'converted',
          },
        ]),
  ]

  const dropped =
    engine?.droppedFrames === undefined
      ? undefined
      : engine.totalFrames === undefined
        ? decimal(engine.droppedFrames, locale, 0)
        : `${decimal(engine.droppedFrames, locale, 0)} / ${decimal(engine.totalFrames, locale, 0)}`
  const engineCodecs = joined([
    engine?.videoCodec,
    engine?.audioCodec === undefined
      ? undefined
      : joined([engine.audioCodec, engine.audioChannels]),
  ])
  const playerRows: InfoRow[] = [
    ...(engine?.width === undefined
      ? []
      : [
          {
            label: t('player.info.picture'),
            value: joined([
              size(engine.width, engine.height),
              engine.frameRate === undefined
                ? undefined
                : t('player.info.fps', { value: decimal(engine.frameRate, locale, 3) }),
            ]),
          },
        ]),
    ...(engineCodecs === '' ? [] : [{ label: t('player.info.codecs'), value: engineCodecs }]),
    ...(engine?.hardwareDecoding === undefined
      ? []
      : [
          {
            label: t('player.info.decoding'),
            value:
              engine.hardwareDecoding === 'no'
                ? t('player.info.softwareDecoding')
                : engine.hardwareDecoding,
          },
        ]),
    ...(dropped === undefined
      ? []
      : [
          {
            label: t('player.info.droppedFrames'),
            value: dropped,
            warn: (engine?.droppedFrames ?? 0) > 0,
          },
        ]),
    ...(engine?.bandwidth === undefined
      ? []
      : [{ label: t('player.info.bandwidth'), value: formatBitrate(engine.bandwidth, locale) }]),
    ...(bufferAheadS === undefined
      ? []
      : [
          {
            label: t('player.info.buffer'),
            value: t('player.info.seconds', { value: decimal(bufferAheadS, locale) }),
          },
        ]),
  ]

  return [
    {
      title: t('player.info.session'),
      rows: [
        {
          label: t('player.info.mode'),
          value: joined([t(`player.info.modes.${mode}`), reasons.join(', ')]),
        },
        {
          label: t('player.menu.quality'),
          value: session.quality === 'original' ? t('player.menu.original') : session.quality,
        },
      ],
    },
    { title: t('player.info.source'), rows: sourceRows },
    { title: t('player.info.stream'), rows: streamRows },
    ...(playerRows.length === 0 ? [] : [{ title: t('player.info.player'), rows: playerRows }]),
  ]
}
