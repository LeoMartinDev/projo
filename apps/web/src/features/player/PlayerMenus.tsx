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

import type {
  AudioTrackDto,
  ChapterDto,
  PlaybackQuality,
  PlaybackSessionDto,
  SubtitleTrackDto,
} from '@projo/shared/api/playback'

import { formatClock } from '../../shared/format/format.ts'
import { currentLocale } from '../../shared/i18n/index.ts'
import { versionLabels } from '../../shared/i18n/versions.ts'
import { CheckIcon, CloseIcon } from '../../shared/ui/icons.tsx'
import { audioCodecLabel, languageName } from '../item/media-labels.ts'
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
} from './subtitles.ts'
import { ratioAtPointer } from './timeline.ts'

/** The menus of the controls row (§10.7), each behind its own button. */
export type PlayerMenu = 'languages' | 'speed' | 'quality' | 'chapters'

/** Tabs of the "Subtitles and audio" menu on narrow screens (two columns from `wideQuery`). */
export type LanguagesTab = 'audio' | 'subtitles'

/** Quality and version only appear when there is a choice to make. */
export const hasQualityChoice = (session: PlaybackSessionDto) =>
  session.availableQualities.length > 1 || session.versions.length > 1

/** Same breakpoint as `.player-menu--languages` in `player.css`. */
const wideQuery = '(min-width: 760px) and (min-height: 561px)'
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

/** The pill sliding under the selected segment (tabs, subtitle size). */
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

/** Title and close: speed, quality, chapters. */
const MenuHeader = ({ title, onClose }: { title: string; onClose: () => void }) => (
  <header className="menu-header">
    <h2 className="menu-header__title">{title}</h2>
    <CloseButton onClose={onClose} />
  </header>
)

const Option = ({
  checked,
  disabled = false,
  label,
  tags = [],
  detail,
  onSelect,
}: {
  checked: boolean
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

/** A titled radio list: a column of the wide languages menu, a group of the quality menu. */
const Section = ({
  title,
  className,
  children,
  footer,
}: {
  title: string
  className?: string
  children: ReactNode
  footer?: ReactNode
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
      <div role="radiogroup" aria-labelledby={id} className="menu-section__options">
        {children}
      </div>
      {footer}
    </section>
  )
}

/**
 * Menu "Subtitles and audio" (§10.7, canvas "Subtitles and audio menu"). Wide screens: audio and
 * subtitles in two columns, size and delay under the subtitles. Narrow screens: tabs Audio and
 * Sous-titres, the height of the longer tab on both (AGENTS.md): the lists scroll inside.
 */
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
  /** The file's own title (`VFF`, `Commentaires`) only tells apart tracks of the same language. */
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
  /** Forced, SDH, and an image track (burnt into the video when chosen, §10.4). */
  const subtitleTags = (track: SubtitleTrackDto) => [
    ...(track.forced ? [t('player.menu.forced')] : []),
    ...(track.sdh ? [t('player.menu.sdh')] : []),
    ...(track.delivery === 'burn_in' ? [t('player.menu.image')] : []),
  ]
  const subtitleKeys = session.subtitleTracks.map((track, position) =>
    [subtitleLabel(track, position), ...subtitleTags(track)].join('|'),
  )
  /**
   * Under the name: not supported, burnt in, or, between tracks that still read the same, where
   * it comes from. The file's own title is left out (`French Full SRT`).
   */
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

  const audioOptions = session.audioTracks.map((track, position) => (
    <Option
      key={track.index}
      checked={track.index === audioIndex}
      label={audioLabel(track, position)}
      detail={audioDetail(track, position)}
      onSelect={() => onAudio(track)}
    />
  ))

  const subtitleOptions = (
    <>
      <Option
        checked={subtitlesOff}
        label={t('player.menu.off')}
        onSelect={() => onSubtitle({ kind: 'off' })}
      />
      {session.subtitleTracks.map((track, position) => (
        <Option
          key={track.id}
          checked={track.id === subtitleId}
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
          <Section title={t('player.menu.audio')} className="menu-section--column">
            {audioOptions}
          </Section>
          <Section
            title={t('player.menu.subtitles')}
            className="menu-section--column"
            footer={subtitleStyle}
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

      {/* Both panels in one cell: the menu takes the height of the longer one, on either tab. */}
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

/** Speed (0.5× to 2×, §10.7). */
export const SpeedMenu = ({
  rate,
  onRate,
  onClose,
}: {
  rate: number
  onRate: (rate: number) => void
  onClose: () => void
}) => {
  const { t } = useTranslation()
  /** Where the thumb is drawn while dragging (it resists between steps), else on the speed. */
  const [drag, setDrag] = useState<number>()
  const number = new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 2 })
  const percent = (value: number) => `${ratioOfRate(value) * 100}%`
  const thumbRatio = drag ?? ratioOfRate(rate)
  const thumb = `${thumbRatio * 100}%`
  const value = number.format(rate)
  const label = `${value}×`

  /** Each step passed while dragging gives a short tap where the device can vibrate. */
  const dragTo = (event: PointerEvent<HTMLDivElement>) => {
    const ratio = ratioAtPointer(event.clientX, event.currentTarget.getBoundingClientRect())
    setDrag(thumbRatioWhileDragging(ratio))
    const next = rateAtRatio(ratio)
    if (next === rate) return
    if ('vibrate' in navigator) navigator.vibrate(8)
    onRate(next)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'PageUp'
        ? rateStepFrom(rate, 1)
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown' || event.key === 'PageDown'
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
    <>
      <MenuHeader title={t('player.menu.speed')} onClose={onClose} />
      <div className="speed-value" aria-hidden="true">
        {value}
        <span className="speed-value__unit">×</span>
      </div>
      <div className="speed-slider">
        <div
          className="speed-slider__control"
          role="slider"
          tabIndex={0}
          aria-label={t('player.menu.speed')}
          aria-valuemin={playbackRates[0]}
          aria-valuemax={playbackRates[playbackRates.length - 1]}
          aria-valuenow={rate}
          aria-valuetext={label}
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
    </>
  )
}

/** Quality, with the versions of the item when it has several (§7.7). */
export const QualityMenu = ({
  session,
  onQuality,
  onVersion,
  onClose,
}: {
  session: PlaybackSessionDto
  onQuality: (quality: PlaybackQuality) => void
  onVersion: (sourceId: string) => void
  onClose: () => void
}) => {
  const { t } = useTranslation()
  const versionNames = versionLabels(
    t,
    session.versions.map((version) => version.version),
  )
  const qualityOptions = (
    session.availableQualities.length > 0 ? session.availableQualities : (['original'] as const)
  ).map((quality) => (
    <Option
      key={quality}
      checked={quality === session.quality}
      label={quality === 'original' ? t('player.menu.original') : quality}
      onSelect={() => onQuality(quality)}
    />
  ))
  return (
    <>
      <MenuHeader title={t('player.menu.quality')} onClose={onClose} />
      {session.versions.length > 1 ? (
        <div className="menu-list">
          <Section title={t('player.menu.version')}>
            {session.versions.map((version, position) => (
              <Option
                key={version.sourceId}
                checked={version.selected}
                label={versionNames[position] ?? ''}
                onSelect={() => onVersion(version.sourceId)}
              />
            ))}
          </Section>
          <Section title={t('player.menu.quality')}>{qualityOptions}</Section>
        </div>
      ) : (
        <div className="menu-list" role="radiogroup" aria-label={t('player.menu.quality')}>
          {qualityOptions}
        </div>
      )}
    </>
  )
}

/** The file's chapters, the current one scrolled into view on opening. */
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
