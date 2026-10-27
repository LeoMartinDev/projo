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
import {
  useHideFromContinue,
  usePlayItem,
  useWatchedToggle,
  useWatchlistToggle,
} from './actions.ts'
import { type CardPlace, type CardText, isPosterPlace, useCardText } from './card-text.ts'
import {
  detailTargetOf,
  isWatched,
  listTargetOf,
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

/** Room kept between the preview and the window's edges. */
const edgePx = 12

/**
 * What is left of the slide of a paged row towards its new page (Row sets the target `transform`
 * of `.row__track` and transitions to it), so the preview is placed for where its card lands.
 */
const remainingSlideOf = (wrapper: HTMLElement) => {
  const track = wrapper.closest<HTMLElement>('.row__track')
  if (!track || track.style.transform === '') return 0
  const current = getComputedStyle(track).transform
  return (
    new DOMMatrix(track.style.transform).m41 - (current === 'none' ? 0 : new DOMMatrix(current).m41)
  )
}

/**
 * Measures where the preview of `wrapper` (a `.cw`) opens: inside its row across (the paged row
 * clips what overflows it) and inside the window under the fixed header down. `undefined` when the
 * preview is not displayed (touch screens).
 */
const measurePreview = (wrapper: HTMLElement, poster: boolean): PreviewPlacement | undefined => {
  const preview = wrapper.querySelector<HTMLElement>('.preview')
  if (!preview || preview.offsetWidth === 0) return undefined
  const root = document.documentElement
  const row = wrapper.closest('.row__viewport')?.getBoundingClientRect()
  const header = Number.parseFloat(getComputedStyle(wrapper).getPropertyValue('--header-height'))
  const box = wrapper.getBoundingClientRect()
  return placePreview({
    card: {
      left: box.left + remainingSlideOf(wrapper),
      top: box.top,
      width: box.width,
      height: box.height,
    },
    // Layout sizes: the closed preview is scaled down.
    preview: { width: preview.offsetWidth, height: preview.offsetHeight },
    bounds: {
      left: Math.max(row?.left ?? edgePx, 0),
      right: Math.min(row?.right ?? root.clientWidth - edgePx, root.clientWidth),
      top: (Number.isNaN(header) ? 0 : header) + edgePx,
      bottom: root.clientHeight - edgePx,
    },
    // The resting place of artboard `Home`.
    restingTop: poster ? -6 : -30,
  })
}

/**
 * Keeps the preview of an open card in place while the page scrolls (focus scrolls a card into
 * view too), the window resizes or the row's slide to another page ends.
 */
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

/**
 * The actions a card reveals (§13.3): Play, My list, Mark as watched, Remove (Continue
 * watching, Up next), More info. Round buttons of artboard `Home`.
 */
const CardActions = ({ item, place }: { item: ItemSummaryDto; place: CardPlace }) => {
  const { t } = useTranslation()
  const text = useCardText()(item, place)
  const watchlist = useWatchlistToggle()
  const watched = useWatchedToggle()
  const hide = useHideFromContinue()
  const play = usePlayItem()
  // An episode's button acts on its series (Continue watching, Up next, §13.3).
  const listTarget = listTargetOf(item)
  const listed = listTarget === undefined ? false : watchlist.listed(listTarget)
  const seen = watched.watched(item)
  const target = detailTargetOf(item)
  return (
    <div className="preview__actions">
      <button
        type="button"
        className="round-button round-button--solid"
        aria-label={t('card.playTitle', { title: text.title })}
        disabled={play.isPending}
        onClick={() => play.mutate(item)}
      >
        <PlayIcon size={16} />
      </button>
      {listTarget === undefined ? undefined : (
        <button
          type="button"
          className="round-button"
          aria-pressed={listed}
          aria-label={listed ? t('card.removeFromList') : t('card.addToList')}
          title={listed ? t('card.removeFromList') : t('card.addToList')}
          onClick={() => watchlist.toggle(listTarget, !listed)}
        >
          {listed ? <AddedIcon /> : <AddIcon />}
        </button>
      )}
      <button
        type="button"
        className="round-button"
        aria-pressed={seen}
        aria-label={seen ? t('card.markUnwatched') : t('card.markWatched')}
        title={seen ? t('card.markUnwatched') : t('card.markWatched')}
        onClick={() => watched.set(item.id, !seen)}
      >
        <SeenIcon />
      </button>
      {place === 'continue_watching' || place === 'up_next' ? (
        <button
          type="button"
          className="round-button"
          aria-label={
            place === 'continue_watching' ? t('card.removeContinue') : t('card.removeUpNext')
          }
          title={place === 'continue_watching' ? t('card.removeContinue') : t('card.removeUpNext')}
          disabled={hide.isPending}
          onClick={() => hide.mutate(item.id)}
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

/**
 * The panel that grows out of a card on hover or focus (artboard `Home`, `.preview`): the artwork
 * runs behind the title and the actions and fades into a panel tinted with its colour
 * (`--card-tint`, artwork-tint.ts), the item's tone without artwork.
 */
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
  /** Opened at least once: the closed preview counts as visible, so its art would load for every card. */
  opened: boolean
}) => {
  const { t } = useTranslation()
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
        <CardActions item={item} place={place} />
        <div className="preview__info">
          <span className="preview__line">{text.line}</span>
          {rating === undefined &&
          text.duration === undefined &&
          quality === undefined ? undefined : (
            <span className="preview__meta">
              <RatingBadge badge={rating} />
              {text.duration === undefined ? undefined : <span>{text.duration}</span>}
              {quality === undefined ? undefined : <span className="rating-badge">{quality}</span>}
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
      </div>
    </div>
  )
}

/**
 * A card of a home row (§13.3): 16:9 with a still or backdrop (Continue watching, Up next,
 * Ma liste) or a 2:3 poster (Recently added, the category rows). The picture carries the
 * title, a progress bar and the "New episode" badge; hover or focus opens the preview with the
 * actions, a long press opens `CardSheet` on touch screens.
 */
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
  /** "Continue watching": the frame of the resume position, instead of the 16:9 image. */
  resumeFrame?: ResumeFrameDto
  onLongPress: (item: ItemSummaryDto) => void
}) => {
  const { t } = useTranslation()
  const text = useCardText()(item, place)
  const press = useLongPress(() => onLongPress(item))
  const poster = isPosterPlace(place)
  const art = poster ? posterOf(item) : wideArtOf(item)
  const ratio = progressRatioOf(item)
  const target = detailTargetOf(item)
  const [wrapper, wrapperRef] = useElement<HTMLDivElement>()
  const [placement, setPlacement] = useState<PreviewPlacement>()
  // Open while hovered or holding the focus (the CSS shows it on `:hover` / `:focus-within`).
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
    // Again once Row has turned to the card's page (its focus handler runs after this one).
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
        {/* The thumbnail it stopped at (§10.5) over the metadata image, kept under it until it loads or when it cannot. */}
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
