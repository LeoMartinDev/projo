import { type KeyboardEvent, type ReactNode, useId, useSyncExternalStore } from 'react'
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
import { Switch } from '../../shared/ui/controls.tsx'
import { audioCodecLabel, languageName } from '../item/media-labels.ts'
import { MinusIcon, PlusSmallIcon } from './player-icons.tsx'
import { playbackRates, type SubtitleSettings } from './player-settings.ts'
import {
  canChoose,
  clampDelay,
  type SubtitleChoice,
  subtitleDelayStepMs,
  subtitleSizes,
} from './subtitles.ts'

/** `languages` (audio and subtitles side by side) on wide screens, `audio` and `subtitles` else. */
export type MenuTab = 'languages' | 'audio' | 'subtitles' | 'quality' | 'playback' | 'chapters'

/** Same breakpoint as `.player-menu` in `player.css`. */
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
      {checked ? <CheckIcon size={13} stroke={3} /> : undefined}
    </span>
  </button>
)

/** A titled radio list: a column of the `languages` tab, a group of the `quality` tab. */
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
 * Menu "Subtitles and audio" (§10.7, canvas "Subtitles and audio menu"). Wide screens: tabs
 * Languages (audio and subtitles in two columns, size and delay under the subtitles), Quality (with
 * the versions), Lecture (speed, Picture-in-Picture), Chapitres. Narrow screens split Langues
 * into Audio and Sous-titres. Same size on every tab (AGENTS.md): the lists scroll inside.
 */
export const TracksMenu = ({
  session,
  audioIndex,
  subtitleId,
  tab,
  onTab,
  onClose,
  onAudio,
  onSubtitle,
  onQuality,
  onVersion,
  rate,
  onRate,
  pip,
  subtitleSettings,
  onSubtitleSettings,
  chapters,
  chapterIndex,
  onChapter,
}: {
  session: PlaybackSessionDto
  audioIndex: number | undefined
  subtitleId: string | undefined
  tab: MenuTab
  onTab: (tab: MenuTab) => void
  onClose: () => void
  onAudio: (track: AudioTrackDto) => void
  onSubtitle: (choice: SubtitleChoice) => void
  onQuality: (quality: PlaybackQuality) => void
  onVersion: (sourceId: string) => void
  rate: number
  onRate: (rate: number) => void
  pip: { supported: boolean; active: boolean; toggle: () => void }
  subtitleSettings: SubtitleSettings
  onSubtitleSettings: (update: (settings: SubtitleSettings) => SubtitleSettings) => void
  chapters: readonly ChapterDto[]
  chapterIndex: number
  onChapter: (positionMs: number) => void
}) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const wide = useWideMenu()
  const baseId = useId()
  const pipLabelId = useId()
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 })
  const versionNames = versionLabels(
    t,
    session.versions.map((version) => version.version),
  )
  const tabs: MenuTab[] = [
    ...(wide ? (['languages'] as const) : (['audio', 'subtitles'] as const)),
    'quality',
    'playback',
    ...(chapters.length > 0 ? (['chapters'] as const) : []),
  ]
  const shownTab: MenuTab = tabs.includes(tab)
    ? tab
    : wide && (tab === 'audio' || tab === 'subtitles')
      ? 'languages'
      : tab === 'languages'
        ? 'subtitles'
        : (tabs[0] ?? 'quality')

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
    const next = tabs[(tabs.indexOf(shownTab) + step + tabs.length) % tabs.length] ?? shownTab
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

  return (
    <div className={`tracks-menu tracks-menu--${wide ? 'wide' : 'compact'}`}>
      <header className="tracks-menu__header">
        <div
          className="menu-segments tracks-menu__tabs"
          role="tablist"
          aria-label={t('player.menu.title')}
          onKeyDown={onTabKey}
        >
          <SegmentIndicator index={tabs.indexOf(shownTab)} count={tabs.length} />
          {tabs.map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              id={`${baseId}-tab-${name}`}
              data-tab={name}
              className="menu-segments__item"
              aria-selected={name === shownTab}
              aria-controls={`${baseId}-panel`}
              tabIndex={name === shownTab ? 0 : -1}
              onClick={() => onTab(name)}
            >
              {t(`player.menu.tabs.${name}`)}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="tracks-menu__close"
          aria-label={t('common.close')}
          onClick={onClose}
        >
          <CloseIcon size={18} />
        </button>
      </header>

      <div
        key={shownTab}
        id={`${baseId}-panel`}
        className="tracks-menu__panel"
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-${shownTab}`}
      >
        {shownTab === 'languages' ? (
          <div className="tracks-menu__columns">
            <Section title={t('player.menu.tabs.audio')} className="menu-section--column">
              {audioOptions}
            </Section>
            <Section
              title={t('player.menu.tabs.subtitles')}
              className="menu-section--column"
              footer={subtitleStyle}
            >
              {subtitleOptions}
            </Section>
          </div>
        ) : undefined}

        {shownTab === 'audio' ? (
          <div
            className="tracks-menu__scroll"
            role="radiogroup"
            aria-label={t('player.menu.tabs.audio')}
          >
            {audioOptions}
          </div>
        ) : undefined}

        {shownTab === 'subtitles' ? (
          <>
            <div
              className="tracks-menu__scroll"
              role="radiogroup"
              aria-label={t('player.menu.tabs.subtitles')}
            >
              {subtitleOptions}
            </div>
            {subtitleStyle}
          </>
        ) : undefined}

        {shownTab === 'quality' && session.versions.length > 1 ? (
          <div className="tracks-menu__scroll">
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
            <Section title={t('player.menu.tabs.quality')}>{qualityOptions}</Section>
          </div>
        ) : undefined}

        {shownTab === 'quality' && session.versions.length <= 1 ? (
          <div
            className="tracks-menu__scroll"
            role="radiogroup"
            aria-label={t('player.menu.tabs.quality')}
          >
            {qualityOptions}
          </div>
        ) : undefined}

        {shownTab === 'playback' ? (
          <div className="tracks-menu__scroll tracks-menu__scroll--padded">
            <section className="menu-speed">
              <h3 className="menu-section__title" id={`${baseId}-speed`}>
                {t('player.menu.speed')}
              </h3>
              <div
                className="menu-speed__rates"
                role="radiogroup"
                aria-labelledby={`${baseId}-speed`}
              >
                {playbackRates.map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    className="menu-speed__rate"
                    aria-checked={rate === value}
                    onClick={() => onRate(value)}
                  >
                    {number.format(value)}×
                  </button>
                ))}
              </div>
            </section>
            {pip.supported ? (
              <div className="menu-toggle">
                <span id={pipLabelId} className="menu-toggle__label">
                  {t('player.menu.pip')}
                </span>
                <Switch checked={pip.active} labelId={pipLabelId} onChange={() => pip.toggle()} />
              </div>
            ) : undefined}
          </div>
        ) : undefined}

        {shownTab === 'chapters' ? (
          <ol className="tracks-menu__scroll menu-chapters">
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
        ) : undefined}
      </div>
    </div>
  )
}
