import { useTranslation } from 'react-i18next'

import type { ItemDetailDto, SourceDto } from '@projo/shared/api/catalog'

import { formatBytes } from '../../shared/format/format.ts'
import { currentLocale } from '../../shared/i18n/index.ts'
import { versionLabels } from '../../shared/i18n/versions.ts'
import {
  audioCodecLabel,
  channelsLabel,
  languageName,
  resolutionLabel,
  videoCodecLabel,
} from './media-labels.ts'

/** `version`: its distinct label when the item has several files (§7.7). */
const SourceInfo = ({ source, version }: { source: SourceDto; version: string | undefined }) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const resolution = resolutionLabel(source.video?.width, source.video?.height)
  const channel = (channels: number | undefined) => {
    const label = channelsLabel(channels)
    return label === 'mono' || label === 'stereo' ? t(`item.channels.${label}`) : label
  }
  return (
    <dl className="tech">
      {version === undefined ? undefined : (
        <div className="tech__row">
          <dt>{t('item.tech.version')}</dt>
          <dd>{version}</dd>
        </div>
      )}
      <div className="tech__row">
        <dt>{t('item.tech.file')}</dt>
        <dd>
          {[source.container.toUpperCase(), formatBytes(source.sizeBytes, locale)].join(' · ')}
        </dd>
      </div>
      {source.video === undefined ? undefined : (
        <div className="tech__row">
          <dt>{t('item.tech.video')}</dt>
          <dd>
            {[
              videoCodecLabel(source.video.codec),
              resolution,
              source.video.width === undefined || source.video.height === undefined
                ? undefined
                : `${source.video.width}×${source.video.height}`,
            ]
              .filter((part) => part !== undefined)
              .join(' · ')}
          </dd>
        </div>
      )}
      {source.audioTracks.length === 0 ? undefined : (
        <div className="tech__row">
          <dt>{t('item.tech.audio')}</dt>
          <dd>
            <ul className="tech__tracks">
              {source.audioTracks.map((track) => (
                <li key={track.index}>
                  {[
                    languageName(track.language, locale) ?? t('item.tech.unknownLanguage'),
                    audioCodecLabel(track.codec),
                    channel(track.channels),
                    track.title,
                  ]
                    .filter((part) => part !== undefined && part.length > 0)
                    .join(' · ')}
                </li>
              ))}
            </ul>
          </dd>
        </div>
      )}
    </dl>
  )
}

const languageList = (codes: readonly string[], locale: string) =>
  [...new Set(codes.map((code) => languageName(code, locale) ?? code))].join(', ')

/**
 * Available tracks (audio and subtitle languages), versions when there are several files, then
 * the technical details of each file (§13.5 "versions, pistes disponibles").
 */
export const TechSection = ({ item }: { item: ItemDetailDto }) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const hasTracks = item.audioLanguages.length > 0 || item.subtitleLanguages.length > 0
  if (!hasTracks && item.sources.length === 0) return undefined
  const versions = versionLabels(
    t,
    item.sources.map((source) => source.version),
  )
  return (
    <section className="detail-section" aria-labelledby="tech-title">
      <h2 id="tech-title" className="detail-section__title">
        {t('item.tech.title')}
      </h2>
      <div className="tech-grid">
        {hasTracks ? (
          <dl className="tech">
            {item.audioLanguages.length === 0 ? undefined : (
              <div className="tech__row">
                <dt>{t('item.tracks.audio')}</dt>
                <dd>{languageList(item.audioLanguages, locale)}</dd>
              </div>
            )}
            {item.subtitleLanguages.length === 0 ? undefined : (
              <div className="tech__row">
                <dt>{t('item.tracks.subtitles')}</dt>
                <dd>{languageList(item.subtitleLanguages, locale)}</dd>
              </div>
            )}
            {item.sources.length > 1 ? (
              <div className="tech__row">
                <dt>{t('item.tracks.versions')}</dt>
                <dd>{versions.join(', ')}</dd>
              </div>
            ) : undefined}
          </dl>
        ) : undefined}
        {item.sources.map((source, index) => (
          <SourceInfo
            key={source.id}
            source={source}
            version={item.sources.length > 1 ? versions[index] : undefined}
          />
        ))}
      </div>
    </section>
  )
}
