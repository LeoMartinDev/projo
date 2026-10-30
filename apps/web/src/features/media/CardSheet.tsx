import { Link } from '@tanstack/react-router'
import { type RefCallback, useCallback, useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ItemSummaryDto } from '@projo/shared/api/catalog'

import { Artwork } from '../../shared/ui/Artwork.tsx'
import { PlayIcon } from '../../shared/ui/icons.tsx'
import { AddedIcon, AddIcon, InfoIcon, RemoveIcon, SeenIcon } from '../../shared/ui/media-icons.tsx'
import { ErrorAlert } from '../../shared/ui/states.tsx'
import { Sheet } from '../../shared/ui/Sheet.tsx'
import { useDevice } from '../../shared/ui/use-media.ts'
import {
  useHideFromContinue,
  usePlayItem,
  useWatchedToggle,
  useWatchlistToggle,
} from './actions.ts'
import { type CardPlace, useCardText } from './card-text.ts'
import { detailTargetOf, listTargetOf, progressRatioOf, toneOf, wideArtOf } from './media.ts'
import { RatingBadge, useRatingBadge } from './RatingBadge.tsx'
import './media.css'

/**
 * The actions of a card, on a long press or a secondary click: My list / Mark as watched / Info,
 * and "Remove" on Continue watching and Up next. On a phone, a bottom sheet (artboard
 * `MobileHome`) with the card's head, its progress and "Play"; on a tablet or a desktop, a menu
 * anchored to the card, which lifts above the dimmed page, as iPadOS does.
 */
export const CardSheet = ({
  item,
  place,
  anchor,
  onClose,
}: {
  item: ItemSummaryDto | undefined
  place: CardPlace
  anchor: HTMLElement | undefined
  onClose: () => void
}) => {
  const titleId = useId()
  const device = useDevice()
  if (device !== 'phone' && item !== undefined && anchor !== undefined)
    return <CardMenu item={item} place={place} anchor={anchor} onClose={onClose} />
  return (
    <Sheet open={item !== undefined} labelledBy={titleId} onClose={onClose}>
      {item === undefined ? undefined : (
        <CardSheetBody item={item} place={place} titleId={titleId} onClose={onClose} />
      )}
    </Sheet>
  )
}

/**
 * The long-press sheet of a poster grid (Movies, Shows, My list, category page). It follows the
 * fresh grid data, and closes when its item leaves the grid (removed from My list).
 */
export const useGridCardSheet = (items: ItemSummaryDto[]) => {
  const [pressed, setPressed] = useState<{ id: string; anchor: HTMLElement }>()
  return {
    onLongPress: (item: ItemSummaryDto, anchor: HTMLElement) => setPressed({ id: item.id, anchor }),
    sheet: (
      <CardSheet
        item={pressed === undefined ? undefined : items.find((item) => item.id === pressed.id)}
        place="grid"
        anchor={pressed?.anchor}
        onClose={() => setPressed(undefined)}
      />
    ),
  }
}

/** Room between the lifted card and the menu, and kept from the window's edges. */
const gap = 12
const margin = 16

/** Below the card when it fits, above otherwise (measured once the dialog is open). */
const placeBeside = (panel: HTMLElement, card: DOMRect) => {
  const below = card.bottom + gap
  const top =
    below + panel.offsetHeight <= window.innerHeight - margin
      ? below
      : Math.max(margin, card.top - gap - panel.offsetHeight)
  panel.style.top = `${top}px`
  panel.style.left = `${Math.min(Math.max(card.left, margin), window.innerWidth - panel.offsetWidth - margin)}px`
}

/**
 * The menu of a wide screen: a copy of the card's picture lifted where the card is, the actions
 * below it (above when there is no room). A rotation or a resize closes it, like iPadOS.
 */
const CardMenu = ({
  item,
  place,
  anchor,
  onClose,
}: {
  item: ItemSummaryDto
  place: CardPlace
  anchor: HTMLElement
  onClose: () => void
}) => {
  const text = useCardText()(item, place)
  // The picture of a home card (its caption stays behind), or a whole grid poster.
  const art = anchor.querySelector<HTMLElement>('.card__art') ?? anchor
  const [rect] = useState(() => art.getBoundingClientRect())

  // Before the first paint: opened (a closed dialog measures 0), then the copy and the panel.
  const open: RefCallback<HTMLDialogElement> = useCallback(
    (dialog) => {
      if (!dialog || dialog.open) return
      dialog.showModal()
      // The menu, not its first button: Safari rings it even after a touch (Sheet.tsx).
      dialog.focus()
      dialog.querySelector('.card-menu__lift')?.replaceChildren(art.cloneNode(true))
      const panel = dialog.querySelector<HTMLElement>('.card-menu__panel')
      if (panel) placeBeside(panel, rect)
    },
    [art, rect],
  )

  useEffect(() => {
    window.addEventListener('resize', onClose)
    return () => window.removeEventListener('resize', onClose)
  }, [onClose])

  return (
    <dialog
      ref={open}
      className="card-menu"
      tabIndex={-1}
      aria-label={text.title}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        // Anywhere but the actions: the dialog fills the window, its empty part is the backdrop.
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className={anchor.closest('.cw--poster') ? 'card-menu__lift cw--poster' : 'card-menu__lift'}
        style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
        aria-hidden="true"
        inert
      />
      <div className="card-menu__panel">
        <CardSheetBody item={item} place={place} onClose={onClose} />
      </div>
    </dialog>
  )
}

const CardSheetBody = ({
  item,
  place,
  titleId,
  onClose,
}: {
  item: ItemSummaryDto
  place: CardPlace
  /** The sheet's heading (picture, title, progress); the menu has the lifted card instead. */
  titleId?: string
  onClose: () => void
}) => {
  const { t } = useTranslation()
  const text = useCardText()(item, place)
  const watchlist = useWatchlistToggle()
  const watched = useWatchedToggle()
  const hide = useHideFromContinue()
  const play = usePlayItem()
  const ratio = progressRatioOf(item)
  const rating = useRatingBadge()(item.contentRating)
  // An episode's tile acts on its series (§13.3).
  const listTarget = listTargetOf(item)
  const listed = listTarget === undefined ? false : watchlist.listed(listTarget)
  const seen = watched.watched(item)
  const target = detailTargetOf(item)
  const removable = place === 'continue_watching' || place === 'up_next'
  const error = watchlist.mutation.error || watched.mutation.error || hide.error || play.error

  return (
    <div className="card-sheet">
      {titleId === undefined ? undefined : (
        <div className="card-sheet__head">
          <span className={`card-sheet__art tone-${toneOf(item.id)}`} aria-hidden="true">
            <Artwork src={wideArtOf(item)} className="cover-img" sizes="auto, 100vw" />
          </span>
          <div className="card-sheet__who">
            <h2 id={titleId} className="card-sheet__title">
              {text.title}
            </h2>
            <span className="card-sheet__line">{text.line}</span>
            {text.duration === undefined && rating === undefined ? undefined : (
              <span className="card-sheet__meta">
                <RatingBadge badge={rating} plain />
                {rating === undefined || text.duration === undefined ? undefined : ' · '}
                {text.duration}
              </span>
            )}
          </div>
        </div>
      )}

      {titleId === undefined || ratio === undefined ? undefined : (
        <div className="progress-line">
          <progress className="bar" value={ratio} max={1} aria-label={t('catalog.inProgress')} />
          {text.remaining === undefined ? undefined : <span>{text.remaining}</span>}
        </div>
      )}

      <button
        type="button"
        className="button button--primary button--large card-sheet__play"
        disabled={play.isPending}
        onClick={() => play.mutate(item)}
      >
        <PlayIcon />
        {ratio === undefined ? t('item.play') : t('card.resume')}
      </button>

      {error ? <ErrorAlert error={error} /> : undefined}

      <div className="sheet-lines">
        {listTarget === undefined ? undefined : (
          <button
            type="button"
            className="sheet-line"
            aria-pressed={listed}
            onClick={() => watchlist.toggle(listTarget, !listed)}
          >
            {listed ? <AddedIcon size={20} /> : <AddIcon size={20} />}
            {t('card.myList')}
          </button>
        )}
        <button
          type="button"
          className="sheet-line"
          aria-pressed={seen}
          onClick={() => watched.set(item.id, !seen)}
        >
          <SeenIcon size={20} />
          {seen ? t('card.markUnwatched') : t('card.markWatched')}
        </button>
        <Link
          to="/items/$itemId"
          params={{ itemId: target.itemId }}
          search={target.season === undefined ? {} : { season: target.season }}
          className="sheet-line"
          onClick={onClose}
        >
          <InfoIcon size={20} />
          {t('card.info')}
        </Link>
        {removable ? (
          <button
            type="button"
            className="sheet-line sheet-line--danger"
            disabled={hide.isPending}
            onClick={() => hide.mutate(item.id, { onSuccess: onClose })}
          >
            <RemoveIcon size={20} />
            {place === 'continue_watching' ? t('card.removeContinue') : t('card.removeUpNext')}
          </button>
        ) : undefined}
      </div>
    </div>
  )
}
