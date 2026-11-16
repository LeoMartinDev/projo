import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useTranslation } from 'react-i18next'

import { versionLabels } from '@projo/i18n/versions'
import type {
  AudioTrackDto,
  ChapterDto,
  PlaybackQuality,
  PlaybackSessionDto,
  SubtitleTrackDto,
} from '@projo/shared/api/playback'

import { formatClock } from '../../../shared/format/format.ts'
import { currentLocale } from '../../../shared/i18n/index.ts'
import { media } from '@projo/design/media'
import { Switch } from '../../../shared/ui/controls.tsx'
import { CheckIcon, CloseIcon } from '../../../shared/ui/icons.tsx'
import { audioCodecLabel, languageName } from '../../item/media-labels.ts'
import { tabStops } from './menu-focus.ts'
import { MinusIcon, PlusSmallIcon } from './player-icons.tsx'
import {
  playbackRates,
  rateAtRatio,
  rateStepFrom,
  ratioOfRate,
  type SubtitleSettings,
  thumbRatioWhileDragging,
} from './player-settings.ts'
import {
  canChoose,
  clampDelay,
  type SubtitleChoice,
  subtitleDelayStepMs,
  subtitleSizes,
} from '@projo/player/core/subtitles'
import { ratioAtPointer } from '@projo/player/core/timeline'

export type PlayerMenu = 'languages' | 'settings' | 'chapters'

export type LanguagesTab = 'audio' | 'subtitles'

export const hasQualityChoice = (session: PlaybackSessionDto) =>
  session.availableQualities.length > 1 || session.versions.length > 1

const wideQuery = `(not ${media.compact}) and (not ${media.short})`
const subscribeWide = (notify: () => void) => {
  const query = window.matchMedia(wideQuery)
  query.addEventListener('change', notify)
  return () => query.removeEventListener('change', notify)
}
const useWideMenu = () =>
  useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(wideQuery).matches,
    () => true,
  )

const SegmentIndicator = ({ index, count }: { index: number; count: number }) => (
  <span
    className="menu-segments__indicator"
    aria-hidden="true"
    style={{
      width: `calc((100% - 8px) / ${count})`,
      transform: `translateX(${Math.max(index, 0) * 100}%)`,
    }}
  />
)

const CloseButton = ({ onClose }: { onClose: () => void }) => {
  const { t } = useTranslation()
  return (
    <button type="button" className="menu-close" aria-label={t('common.close')} onClick={onClose}>
      <CloseIcon size={18} />
    </button>
  )
}

const MenuHeader = ({ title, onClose }: { title: string; onClose: () => void }) => (
  <header className="menu-header">
    <h2 className="menu-header__title">{title}</h2>
    <CloseButton onClose={onClose} />
  </header>
)

const Option = ({
  checked,
  tabStop = checked,
  disabled = false,
  label,
  tags = [],
  detail,
  onSelect,
}: {
  checked: boolean
  // The group's one tab stop (menu-focus.ts): the checked option, else the first.
  tabStop?: boolean | undefined
  disabled?: boolean
  label: string
  tags?: readonly string[]
  detail?: string | undefined
  onSelect: () => void
}) => (
  <button
    type="button"
    role="radio"
    className="menu-option"
    aria-checked={checked}
    aria-disabled={disabled}
    tabIndex={tabStop ? 0 : -1}
    onClick={() => {
      if (!disabled && !checked) onSelect()
    }}
  >
    <span className="menu-option__text">
      <span className="menu-option__title">
        <span className="menu-option__label">{label}</span>
        {tags.map((tag) => (
          <span key={tag} className="menu-option__tag">
            {tag}
          </span>
        ))}
      </span>
      {detail === undefined || detail === '' ? undefined : (
        <span className="menu-option__detail">{detail}</span>
      )}
    </span>
    <span className="menu-option__dot" aria-hidden="true">
      {checked ? <CheckIcon size={18} stroke={2.4} /> : undefined}
    </span>
  </button>
)

const Section = ({
  title,
  className,
  children,
  footer,
  initialFocus = false,
}: {
  title: string
  className?: string
  children: ReactNode
  footer?: ReactNode
  // Where focus goes when the menu opens (menu-focus.ts).
  initialFocus?: boolean
}) => {
  const id = useId()
  return (
    <section
      className={`menu-section${className === undefined ? '' : ` ${className}`}`}
      aria-labelledby={id}
    >
      <h3 id={id} className="menu-section__title">
        {title}
      </h3>
      <div
        role="radiogroup"
        aria-labelledby={id}
        className="menu-section__options"
        data-initial-focus={initialFocus ? '' : undefined}
      >
        {children}
      </div>
      {footer}
    </section>
  )
}

export const LanguagesMenu = ({
  session,
  audioIndex,
  subtitleId,
  tab,
  onTab,
  onClose,
  onAudio,
  onSubtitle,
  subtitleSettings,
  onSubtitleSettings,
  sizeAdjustable,
}: {
  session: PlaybackSessionDto
  audioIndex: number | undefined
  subtitleId: string | undefined
  tab: LanguagesTab
  onTab: (tab: LanguagesTab) => void
  onClose: () => void
  onAudio: (track: AudioTrackDto) => void
  onSubtitle: (choice: SubtitleChoice) => void
  subtitleSettings: SubtitleSettings
  onSubtitleSettings: (update: (settings: SubtitleSettings) => SubtitleSettings) => void
  sizeAdjustable: boolean
}) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const wide = useWideMenu()
  const baseId = useId()
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 })
  const tabs: LanguagesTab[] = ['audio', 'subtitles']

  const channels = (count: number | undefined) =>
    count === undefined
      ? undefined
      : count === 1
        ? t('player.menu.mono')
        : count === 2
          ? t('player.menu.stereo')
          : count === 6
            ? '5.1'
            : count === 8
              ? '7.1'
              : t('player.menu.channels', { count })

  const audioLabel = (track: AudioTrackDto, position: number) =>
    languageName(track.language, locale) ??
    track.title ??
    t('player.menu.track', { number: position + 1 })
  const audioLabels = session.audioTracks.map((track, position) => audioLabel(track, position))
  const audioDetail = (track: AudioTrackDto, position: number) =>
    [
      languageName(track.language, locale) !== undefined &&
      audioLabels.filter((label) => label === audioLabels[position]).length > 1
        ? track.title
        : undefined,
      channels(track.channels),
      audioCodecLabel(track.codec),
    ]
      .filter((part) => part !== undefined && part !== '')
      .join(' · ')

  const subtitleLabel = (track: SubtitleTrackDto, position: number) =>
    languageName(track.language, locale) ??
    track.title ??
    t('player.menu.track', { number: position + 1 })
  const subtitleTags = (track: SubtitleTrackDto) => [
    ...(track.forced ? [t('player.menu.forced')] : []),
    ...(track.sdh ? [t('player.menu.sdh')] : []),
    ...(track.delivery === 'burn_in' ? [t('player.menu.image')] : []),
  ]
  const subtitleKeys = session.subtitleTracks.map((track, position) =>
    [subtitleLabel(track, position), ...subtitleTags(track)].join('|'),
  )
  const subtitleDetail = (track: SubtitleTrackDto, position: number) => {
    if (track.delivery === 'unsupported') return t('player.menu.unsupported')
    if (track.id === subtitleId && session.burnIn) return t('player.burnIn')
    const twins = session.subtitleTracks.filter(
      (_other, index) => subtitleKeys[index] === subtitleKeys[position],
    )
    return twins.some((other) => other.origin !== track.origin)
      ? t(`player.menu.origin.${track.origin}`)
      : undefined
  }

  const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (step === 0) return
    event.preventDefault()
    const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length] ?? tab
    onTab(next)
    event.currentTarget.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus()
  }

  const subtitlesOff = subtitleId === undefined
  const delay = subtitleSettings.delayMs
  const delayText = `${delay > 0 ? '+' : delay < 0 ? '−' : ''}${number.format(Math.abs(delay) / 1000)} s`
  const shiftDelay = (stepMs: number) =>
    onSubtitleSettings((settings) => ({
      ...settings,
      delayMs: stepMs === 0 ? 0 : clampDelay(settings.delayMs + stepMs),
    }))

  const audioStops = tabStops(session.audioTracks.map((track) => track.index === audioIndex))
  const subtitleStops = tabStops([
    subtitlesOff,
    ...session.subtitleTracks.map((track) => track.id === subtitleId),
  ])
  const audioOptions = session.audioTracks.map((track, position) => (
    <Option
      key={track.index}
      checked={track.index === audioIndex}
      tabStop={audioStops[position]}
      label={audioLabel(track, position)}
      detail={audioDetail(track, position)}
      onSelect={() => onAudio(track)}
    />
  ))

  const subtitleOptions = (
    <>
      <Option
        checked={subtitlesOff}
        tabStop={subtitleStops[0]}
        label={t('player.menu.off')}
        onSelect={() => onSubtitle({ kind: 'off' })}
      />
      {session.subtitleTracks.map((track, position) => (
        <Option
          key={track.id}
          checked={track.id === subtitleId}
          tabStop={subtitleStops[position + 1]}
          disabled={!canChoose(track)}
          label={subtitleLabel(track, position)}
          tags={subtitleTags(track)}
          detail={subtitleDetail(track, position)}
          onSelect={() => onSubtitle({ kind: 'track', track })}
        />
      ))}
    </>
  )

  const sizeIndex = subtitleSizes.indexOf(subtitleSettings.size)
  const subtitleStyle = (
    <div className={`menu-style${subtitlesOff ? ' menu-style--off' : ''}`}>
      {sizeAdjustable ? (
        <div className="menu-setting">
          <span className="menu-setting__label">{t('player.menu.size')}</span>
          <div className="menu-segments" role="radiogroup" aria-label={t('player.menu.size')}>
            <SegmentIndicator index={sizeIndex} count={subtitleSizes.length} />
            {subtitleSizes.map((size) => (
              <button
                key={size}
                type="button"
                role="radio"
                className={`menu-segments__item menu-size--${size}`}
                aria-checked={subtitleSettings.size === size}
                tabIndex={subtitleSettings.size === size ? 0 : -1}
                aria-label={t(`player.menu.sizes.${size}`)}
                title={t(`player.menu.sizes.${size}`)}
                disabled={subtitlesOff}
                onClick={() => onSubtitleSettings((settings) => ({ ...settings, size }))}
              >
                A
              </button>
            ))}
          </div>
        </div>
      ) : undefined}
      <div className="menu-setting">
        <span className="menu-setting__label">{t('player.menu.delay')}</span>
        <div className="menu-stepper">
          <button
            type="button"
            className="menu-stepper__button"
            aria-label={t('player.menu.delayEarlier')}
            disabled={subtitlesOff}
            onClick={() => shiftDelay(-subtitleDelayStepMs)}
          >
            <MinusIcon size={16} />
          </button>
          <button
            type="button"
            className={`menu-stepper__value${delay === 0 ? ' menu-stepper__value--zero' : ''}`}
            aria-label={t('player.menu.delayReset', { value: delayText })}
            disabled={subtitlesOff}
            onClick={() => shiftDelay(0)}
          >
            {delayText}
          </button>
          <button
            type="button"
            className="menu-stepper__button"
            aria-label={t('player.menu.delayLater')}
            disabled={subtitlesOff}
            onClick={() => shiftDelay(subtitleDelayStepMs)}
          >
            <PlusSmallIcon size={16} />
          </button>
        </div>
      </div>
    </div>
  )

  if (wide)
    return (
      <div className="tracks-menu tracks-menu--wide">
        <div className="tracks-menu__columns">
          <Section
            title={t('player.menu.audio')}
            className="menu-section--column"
            initialFocus={tab === 'audio'}
          >
            {audioOptions}
          </Section>
          <Section
            title={t('player.menu.subtitles')}
            className="menu-section--column"
            footer={subtitleStyle}
            initialFocus={tab === 'subtitles'}
          >
            {subtitleOptions}
          </Section>
        </div>
        <CloseButton onClose={onClose} />
      </div>
    )

  return (
    <div className="tracks-menu tracks-menu--compact">
      <header className="menu-header menu-header--tabs">
        <div
          className="menu-segments tracks-menu__tabs"
          role="tablist"
          aria-label={t('player.menu.title')}
          onKeyDown={onTabKey}
        >
          <SegmentIndicator index={tabs.indexOf(tab)} count={tabs.length} />
          {tabs.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              id={`${baseId}-tab-${name}`}
              data-tab={name}
              className="menu-segments__item"
              aria-selected={name === tab}
              aria-controls={`${baseId}-panel-${name}`}
              tabIndex={name === tab ? 0 : -1}
              onClick={() => onTab(name)}
            >
              {t(`player.menu.${name}`)}
            </button>
          ))}
        </div>
        <CloseButton onClose={onClose} />
      </header>

      <div className="tracks-menu__panels">
        {tabs.map((name) => (
          <div
            key={name}
            id={`${baseId}-panel-${name}`}
            className="tracks-menu__panel"
            role="tabpanel"
            aria-labelledby={`${baseId}-tab-${name}`}
            data-active={name === tab ? '' : undefined}
            inert={name !== tab}
          >
            <div className="menu-list" role="radiogroup" aria-label={t(`player.menu.${name}`)}>
              {name === 'audio' ? audioOptions : subtitleOptions}
            </div>
            {name === 'subtitles' ? subtitleStyle : undefined}
          </div>
        ))}
      </div>
    </div>
  )
}

const SpeedSlider = ({
  rate,
  onRate,
  label,
  valueText,
  number,
}: {
  rate: number
  onRate: (rate: number) => void
  label: string
  valueText: string
  number: Intl.NumberFormat
}) => {
  const [drag, setDrag] = useState<number>()
  const percent = (value: number) => `${ratioOfRate(value) * 100}%`
  const thumbRatio = drag ?? ratioOfRate(rate)
  const thumb = `${thumbRatio * 100}%`

  const dragTo = (event: PointerEvent<HTMLDivElement>) => {
    const ratio = ratioAtPointer(event.clientX, event.currentTarget.getBoundingClientRect())
    setDrag(thumbRatioWhileDragging(ratio))
    const next = rateAtRatio(ratio)
    if (next === rate) return
    if ('vibrate' in navigator) navigator.vibrate(8)
    onRate(next)
  }

  // ↑/↓ leave the slider for the menu's other settings (menu-focus.ts).
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next =
      event.key === 'ArrowRight' || event.key === 'PageUp'
        ? rateStepFrom(rate, 1)
        : event.key === 'ArrowLeft' || event.key === 'PageDown'
          ? rateStepFrom(rate, -1)
          : event.key === 'Home'
            ? playbackRates[0]
            : event.key === 'End'
              ? playbackRates[playbackRates.length - 1]
              : undefined
    if (next === undefined) return
    event.preventDefault()
    onRate(next)
  }

  return (
    <div className="speed-slider">
      <div
        className="speed-slider__control"
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={playbackRates[0]}
        aria-valuemax={playbackRates[playbackRates.length - 1]}
        aria-valuenow={rate}
        aria-valuetext={valueText}
        data-dragging={drag === undefined ? undefined : ''}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.currentTarget.setPointerCapture(event.pointerId)
          dragTo(event)
        }}
        onPointerMove={(event) => {
          if (drag !== undefined) dragTo(event)
        }}
        onPointerUp={() => setDrag(undefined)}
        onPointerCancel={() => setDrag(undefined)}
      >
        <span className="speed-slider__track" aria-hidden="true">
          <span className="speed-slider__fill" style={{ width: thumb }} />
          {playbackRates.map((value) => (
            <span
              key={value}
              className="speed-slider__detent"
              data-passed={ratioOfRate(value) <= thumbRatio ? '' : undefined}
              style={{ left: percent(value) }}
            />
          ))}
        </span>
        <span className="speed-slider__thumb" aria-hidden="true" style={{ left: thumb }} />
      </div>
      <div className="speed-slider__labels" aria-hidden="true">
        {playbackRates.map((value) => (
          <button
            key={value}
            type="button"
            tabIndex={-1}
            className="speed-slider__label"
            data-current={value === rate ? '' : undefined}
            style={{ left: percent(value) }}
            onClick={() => onRate(value)}
          >
            {number.format(value)}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Speed, then version and quality when there is a choice, then the playback
 * info switch (§10.7).
 */
export const SettingsMenu = ({
  session,
  rate,
  onRate,
  onQuality,
  onVersion,
  infoShown,
  onInfoShown,
  onClose,
}: {
  session: PlaybackSessionDto
  rate: number
  onRate: (rate: number) => void
  onQuality: (quality: PlaybackQuality) => void
  onVersion: (sourceId: string) => void
  infoShown: boolean
  onInfoShown: (shown: boolean) => void
  onClose: () => void
}) => {
  const { t } = useTranslation()
  const speedTitleId = useId()
  const infoLabelId = useId()
  const number = new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 2 })
  const rateText = `${number.format(rate)}×`
  const versionNames = versionLabels(
    t,
    session.versions.map((version) => version.version),
  )
  const qualities =
    session.availableQualities.length > 0 ? session.availableQualities : (['original'] as const)
  const qualityStops = tabStops(qualities.map((quality) => quality === session.quality))
  const versionStops = tabStops(session.versions.map((version) => version.selected))
  const qualityOptions = qualities.map((quality, position) => (
    <Option
      key={quality}
      checked={quality === session.quality}
      tabStop={qualityStops[position]}
      label={quality === 'original' ? t('player.menu.original') : quality}
      onSelect={() => onQuality(quality)}
    />
  ))
  return (
    <>
      <MenuHeader title={t('player.menu.settings')} onClose={onClose} />
      <div className="menu-list settings-menu__sections">
        <section className="menu-section" aria-labelledby={speedTitleId}>
          <h3 id={speedTitleId} className="menu-section__title">
            {t('player.menu.speed')}
            <span className="menu-section__value" aria-hidden="true">
              {' · '}
              {rateText}
            </span>
          </h3>
          <SpeedSlider
            rate={rate}
            onRate={onRate}
            label={t('player.menu.speed')}
            valueText={rateText}
            number={number}
          />
        </section>
        {hasQualityChoice(session) && session.versions.length > 1 ? (
          <Section title={t('player.menu.version')}>
            {session.versions.map((version, position) => (
              <Option
                key={version.sourceId}
                checked={version.selected}
                tabStop={versionStops[position]}
                label={versionNames[position] ?? ''}
                onSelect={() => onVersion(version.sourceId)}
              />
            ))}
          </Section>
        ) : undefined}
        {hasQualityChoice(session) ? (
          <Section title={t('player.menu.quality')}>{qualityOptions}</Section>
        ) : undefined}
      </div>
      <div className="menu-info">
        <span id={infoLabelId} className="menu-info__label">
          {t('player.info.title')}
        </span>
        <Switch checked={infoShown} labelId={infoLabelId} onChange={onInfoShown} />
      </div>
    </>
  )
}

export const ChaptersMenu = ({
  chapters,
  chapterIndex,
  onChapter,
  onClose,
}: {
  chapters: readonly ChapterDto[]
  chapterIndex: number
  onChapter: (positionMs: number) => void
  onClose: () => void
}) => {
  const { t } = useTranslation()
  const listRef = useRef<HTMLOListElement | undefined>(undefined)
  useEffect(() => {
    listRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [])
  return (
    <>
      <MenuHeader title={t('player.menu.chapters')} onClose={onClose} />
      <ol
        ref={(node) => {
          listRef.current = node ?? undefined
        }}
        className="menu-list menu-chapters"
        data-arrow-list
      >
        {chapters.map((chapter, position) => (
          <li key={chapter.startMs}>
            <button
              type="button"
              className="menu-chapter"
              aria-current={position === chapterIndex ? 'true' : undefined}
              onClick={() => onChapter(chapter.startMs)}
            >
              <span className="menu-chapter__title">
                {chapter.title ?? t('player.menu.chapterNumber', { number: position + 1 })}
              </span>
              <span className="menu-chapter__time">{formatClock(chapter.startMs)}</span>
            </button>
          </li>
        ))}
      </ol>
    </>
  )
}
