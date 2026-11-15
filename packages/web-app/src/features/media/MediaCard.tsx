import { Link } from '@tanstack/react-router'
import {
  type CSSProperties,
  type FocusEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'

import { genreLabels } from '@projo/i18n/genres'
import type { ItemSummaryDto } from '@projo/shared/api/catalog'
import type { ResumeFrameDto } from '@projo/shared/api/home'

import { RatingBadge, useRatingBadge } from './RatingBadge.tsx'
import { Score } from './Score.tsx'
import { useErrorMessage } from '../../shared/i18n/errors.ts'
import { Artwork } from '../../shared/ui/Artwork.tsx'
import { PlayIcon } from '../../shared/ui/icons.tsx'
import { useElement } from '../../shared/ui/use-element.ts'
import {
  AddedIcon,
  AddIcon,
  ChevronDownSmallIcon,
  RemoveIcon,
  SeenIcon,
} from '../../shared/ui/media-icons.tsx'
import { type CardActions, useCardActions } from './actions.ts'
import { useCardText } from './card-text.ts'
import {
  type CardPlace,
  type CardText,
  detailTargetOf,
  isPosterPlace,
  isWatched,
  posterOf,
  progressRatioOf,
  qualityLabel,
  toneOf,
  wideArtOf,
} from './media.ts'
import { type PreviewPlacement, placePreview } from './preview-placement.ts'
import { requestArtworkTint, useArtworkTint } from './use-artwork-tint.ts'
import { useLongPress } from './use-long-press.ts'
import './media.css'

const edgePx = 12

const remainingSlideOf = (wrapper: HTMLElement) => {
  const track = wrapper.closest<HTMLElement>('.row__track')
  if (!track || track.style.transform === '') return 0
  const current = getComputedStyle(track).transform
  return (
    new DOMMatrix(track.style.transform).m41 - (current === 'none' ? 0 : new DOMMatrix(current).m41)
  )
}

const measurePreview = (wrapper: HTMLElement, poster: boolean): PreviewPlacement | undefined => {
  const preview = wrapper.querySelector<HTMLElement>('.preview')
  if (!preview || preview.offsetWidth === 0) return undefined
  const root = document.documentElement
  const row = wrapper.closest('.row__viewport')?.getBoundingClientRect()
  const header = document.querySelector('.shell__header')?.getBoundingClientRect().bottom ?? 0
  const box = wrapper.getBoundingClientRect()
  return placePreview({
    card: {
      left: box.left + remainingSlideOf(wrapper),
      top: box.top,
      width: box.width,
      height: box.height,
    },
    preview: { width: preview.offsetWidth, height: preview.offsetHeight },
    bounds: {
      left: Math.max(row?.left ?? edgePx, 0),
      right: Math.min(row?.right ?? root.clientWidth - edgePx, root.clientWidth),
      top: header + edgePx,
      bottom: root.clientHeight - edgePx,
    },
    restingTop: poster ? -6 : -30,
  })
}

const useFollowPreview = (
  wrapper: HTMLElement | undefined,
  open: boolean,
  update: (wrapper: HTMLElement) => void,
) => {
  useEffect(() => {
    if (!open || wrapper === undefined) return
    const track = wrapper.closest('.row__track')
    let frame = 0
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => update(wrapper))
    }
    const onSlide = (event: Event) => {
      if (event.target === track) schedule()
    }
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    track?.addEventListener('transitionend', onSlide)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      track?.removeEventListener('transitionend', onSlide)
    }
  }, [wrapper, open, update])
}

const PreviewActions = ({ item, actions }: { item: ItemSummaryDto; actions: CardActions }) => {
  const { t } = useTranslation()
  const text = useCardText()(item)
  const { listed, seen } = actions
  const target = detailTargetOf(item)
  return (
    <div className="preview__actions">
      <button
        type="button"
        className="round-button round-button--solid"
        aria-label={t('card.playTitle', { title: text.title })}
        disabled={actions.playing}
        onClick={actions.play}
      >
        <PlayIcon size={16} />
      </button>
      {actions.canList ? (
        <button
          type="button"
          className="round-button"
          aria-pressed={listed}
          aria-label={listed ? t('card.removeFromList') : t('card.addToList')}
          title={listed ? t('card.removeFromList') : t('card.addToList')}
          onClick={actions.toggleList}
        >
          {listed ? <AddedIcon /> : <AddIcon />}
        </button>
      ) : undefined}
      <button
        type="button"
        className="round-button"
        aria-pressed={seen}
        aria-label={seen ? t('card.markUnwatched') : t('card.markWatched')}
        title={seen ? t('card.markUnwatched') : t('card.markWatched')}
        onClick={actions.toggleSeen}
      >
        <SeenIcon />
      </button>
      {actions.removable ? (
        <button
          type="button"
          className="round-button"
          aria-label={t('card.removeContinue')}
          title={t('card.removeContinue')}
          disabled={actions.removing}
          onClick={() => actions.remove()}
        >
          <RemoveIcon />
        </button>
      ) : undefined}
      <span className="preview__spacer" />
      <Link
        to="/items/$itemId"
        params={{ itemId: target.itemId }}
        search={target.season === undefined ? {} : { season: target.season }}
        className="round-button"
        aria-label={t('card.infoOn', { title: text.title })}
        title={t('card.info')}
      >
        <ChevronDownSmallIcon />
      </Link>
    </div>
  )
}

const Preview = ({
  item,
  place,
  text,
  placement,
  opened,
}: {
  item: ItemSummaryDto
  place: CardPlace
  text: CardText
  placement: PreviewPlacement | undefined
  opened: boolean
}) => {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const actions = useCardActions(item, place)
  const ratio = progressRatioOf(item)
  const quality = qualityLabel(item.bestQuality)
  const rating = useRatingBadge()(item.contentRating)
  const genres = genreLabels(t, item.genres, 3)
  const art = wideArtOf(item)
  const tint = useArtworkTint(art)
  const style = {
    ...(placement === undefined
      ? {}
      : {
          left: placement.left,
          top: placement.top,
          transformOrigin: `${placement.originX * 100}% 50%`,
        }),
    ...(tint === undefined ? {} : { '--card-tint': tint }),
  } as CSSProperties
  return (
    <div
      className={`preview tone-${toneOf(item.id)}`}
      role="group"
      aria-label={t('card.previewOf', { title: text.title })}
      style={style}
    >
      <div className="preview__art" aria-hidden="true">
        <Artwork
          src={opened ? art : undefined}
          className="cover-img preview__img"
          sizes="auto, 25vw"
        />
      </div>
      <div className="preview__head">
        <span className="preview__title" aria-hidden="true">
          {text.title}
        </span>
      </div>
      <div className="preview__body">
        <PreviewActions item={item} actions={actions} />
        {actions.error ? (
          <div className="preview__info">
            <span className="preview__error" role="alert">
              {errorMessage(actions.error)}
            </span>
          </div>
        ) : (
          <div className="preview__info">
            <span className="preview__line">{text.line}</span>
            {rating === undefined &&
            text.duration === undefined &&
            text.score === undefined &&
            quality === undefined ? undefined : (
              <span className="preview__meta">
                <RatingBadge badge={rating} />
                <Score score={text.score} />
                {text.duration === undefined ? undefined : <span>{text.duration}</span>}
                {quality === undefined ? undefined : (
                  <span className="rating-badge">{quality}</span>
                )}
              </span>
            )}
            {genres.length === 0 ? undefined : (
              <span className="preview__genres">{genres.join(' · ')}</span>
            )}
            {ratio === undefined ? undefined : (
              <span className="progress-line">
                <progress className="bar" value={ratio} max={1} aria-hidden="true" />
                {text.remaining === undefined ? undefined : <span>{text.remaining}</span>}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export const MediaCard = ({
  item,
  place,
  isNew = false,
  resumeFrame,
  onLongPress,
}: {
  item: ItemSummaryDto
  place: CardPlace
  isNew?: boolean
  resumeFrame?: ResumeFrameDto
  onLongPress: (item: ItemSummaryDto, anchor: HTMLElement) => void
}) => {
  const { t } = useTranslation()
  const text = useCardText()(item)
  const press = useLongPress((anchor) => onLongPress(item, anchor))
  const poster = isPosterPlace(place)
  const art = poster ? posterOf(item) : wideArtOf(item)
  const ratio = progressRatioOf(item)
  const target = detailTargetOf(item)
  const [wrapper, wrapperRef] = useElement<HTMLDivElement>()
  const [placement, setPlacement] = useState<PreviewPlacement>()
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const opened = hovered || focused || placement !== undefined
  const update = useCallback(
    (element: HTMLElement) => setPlacement(measurePreview(element, poster)),
    [poster],
  )
  useFollowPreview(wrapper, hovered || focused, update)
  const onPointerEnter = (event: PointerEvent<HTMLElement>) => {
    requestArtworkTint(wideArtOf(item))
    update(event.currentTarget)
    setHovered(true)
  }
  const onFocus = (event: FocusEvent<HTMLElement>) => {
    const element = event.currentTarget
    requestArtworkTint(wideArtOf(item))
    update(element)
    setFocused(true)
    requestAnimationFrame(() => update(element))
  }
  const onBlur = (event: FocusEvent<HTMLElement>) => {
    if (!(event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)))
      setFocused(false)
  }

  const body = (
    <>
      <span className={`card__art tone-${toneOf(item.id)}`}>
        <Artwork src={art} className="cover-img" {...(poster ? {} : { sizes: 'auto, 25vw' })} />
        {resumeFrame === undefined ? undefined : (
          <Artwork src={resumeFrame.url} className="cover-img" />
        )}
        <span className="card__shade" aria-hidden="true" />
        {isNew ? <span className="card__badge">{t('card.newEpisode')}</span> : undefined}
        <span className="card__title">{text.title}</span>
        {ratio === undefined ? undefined : (
          <progress
            className="bar card__progress"
            value={ratio}
            max={1}
            aria-label={t('catalog.inProgress')}
          />
        )}
        {ratio === undefined && isWatched(item) ? (
          <span className="card__watched visually-hidden">{t('catalog.watched')}</span>
        ) : undefined}
      </span>
      {poster ? undefined : (
        <span className="card__caption">
          <span className="card__sub">{text.sub}</span>
          {text.right === undefined ? undefined : <span className="card__right">{text.right}</span>}
        </span>
      )}
    </>
  )

  return (
    <div
      ref={wrapperRef}
      className={poster ? 'cw cw--poster' : 'cw'}
      onPointerEnter={onPointerEnter}
      onPointerLeave={() => setHovered(false)}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      {place === 'continue_watching' ? (
        <Link to="/watch/$itemId" params={{ itemId: item.id }} className="card" {...press}>
          {body}
        </Link>
      ) : (
        <Link
          to="/items/$itemId"
          params={{ itemId: target.itemId }}
          search={target.season === undefined ? {} : { season: target.season }}
          className="card"
          {...press}
        >
          {body}
        </Link>
      )}
      <Preview item={item} place={place} text={text} placement={placement} opened={opened} />
    </div>
  )
}
