import { Link } from '@tanstack/react-router'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ItemSummaryDto } from '@projo/shared/api/catalog'

import { Artwork } from '../../shared/ui/Artwork.tsx'
import { PlayIcon } from '../../shared/ui/icons.tsx'
import { AddedIcon, AddIcon, InfoIcon, RemoveIcon, SeenIcon } from '../../shared/ui/media-icons.tsx'
import { ErrorAlert } from '../../shared/ui/states.tsx'
import { Sheet } from '../../shared/ui/Sheet.tsx'
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
 * Long press on a card (artboard `MobileHome`): the card's head, its progress, "Play", then Ma
 * list / Mark as watched / Info, and "Remove" on Continue watching and Up next.
 */
export const CardSheet = ({
  item,
  place,
  onClose,
}: {
  item: ItemSummaryDto | undefined
  place: CardPlace
  onClose: () => void
}) => {
  const titleId = useId()
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
  const [id, setId] = useState<string>()
  return {
    onLongPress: (item: ItemSummaryDto) => setId(item.id),
    sheet: (
      <CardSheet
        item={id === undefined ? undefined : items.find((item) => item.id === id)}
        place="grid"
        onClose={() => setId(undefined)}
      />
    ),
  }
}

const CardSheetBody = ({
  item,
  place,
  titleId,
  onClose,
}: {
  item: ItemSummaryDto
  place: CardPlace
  titleId: string
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

      {ratio === undefined ? undefined : (
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

      <div className="card-sheet__actions">
        {listTarget === undefined ? undefined : (
          <button
            type="button"
            className="sheet-tile"
            aria-pressed={listed}
            onClick={() => watchlist.toggle(listTarget, !listed)}
          >
            {listed ? <AddedIcon size={22} /> : <AddIcon size={22} />}
            {t('card.myList')}
          </button>
        )}
        <button
          type="button"
          className="sheet-tile"
          aria-pressed={seen}
          onClick={() => watched.set(item.id, !seen)}
        >
          <SeenIcon size={22} />
          {seen ? t('card.markUnwatched') : t('card.markWatched')}
        </button>
        <Link
          to="/items/$itemId"
          params={{ itemId: target.itemId }}
          search={target.season === undefined ? {} : { season: target.season }}
          className="sheet-tile"
          onClick={onClose}
        >
          <InfoIcon size={22} />
          {t('card.info')}
        </Link>
      </div>

      {removable ? (
        <div className="sheet-lines">
          <button
            type="button"
            className="sheet-line sheet-line--danger"
            disabled={hide.isPending}
            onClick={() => hide.mutate(item.id, { onSuccess: onClose })}
          >
            <RemoveIcon size={20} />
            {place === 'continue_watching' ? t('card.removeContinue') : t('card.removeUpNext')}
          </button>
        </div>
      ) : undefined}
    </div>
  )
}
