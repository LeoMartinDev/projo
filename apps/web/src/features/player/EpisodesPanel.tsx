import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { ItemSummaryDto } from '@projo/shared/api/catalog'

import { formatDuration } from '../../shared/format/format.ts'
import { currentLocale } from '../../shared/i18n/index.ts'
import { itemTitle, listedNumber } from '../../shared/i18n/item-titles.ts'
import { Artwork } from '../../shared/ui/Artwork.tsx'
import { CloseIcon } from '../../shared/ui/icons.tsx'
import { childrenQuery } from '../catalog/queries.ts'
import { durationMsOf, progressRatioOf, toneOf } from '../media/media.ts'
import { episodeCards, episodeNumberLabel, holds, sortedSeasons } from './next-episode.ts'
import '../media/media.css'

const skeletonRows = [0, 1, 2, 3, 4]

/**
 * Episodes of the season, beside the video (control "Episode list"): season pills when
 * the series has several, the episodes with still, progress and duration; the playing one is
 * marked. Fixed width and height, the list scrolls (AGENTS.md).
 */
export const EpisodesPanel = ({
  seriesId,
  seasonId,
  currentId,
  fallbackArt,
  onPlay,
  onClose,
}: {
  seriesId: string
  seasonId: string | undefined
  currentId: string
  fallbackArt: string | undefined
  onPlay: (episode: ItemSummaryDto) => void
  onClose: () => void
}) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const seasons = useQuery(childrenQuery(seriesId))
  const [chosenSeasonId, setChosenSeasonId] = useState<string>()
  const shownSeasonId = chosenSeasonId ?? seasonId
  const episodes = useQuery({
    ...childrenQuery(shownSeasonId ?? ''),
    enabled: shownSeasonId !== undefined,
  })
  const seasonItems = sortedSeasons(seasons.data?.items ?? [])
  const episodeItems = episodes.data?.items ?? []
  const playing = episodeItems.find((episode) => episode.id === currentId)
  const seasonLabel = (item: ItemSummaryDto) =>
    item.seasonNumber === 0
      ? t('item.specials')
      : item.seasonNumber === undefined
        ? itemTitle(t, item)
        : t('item.season', { number: item.seasonNumber })

  return (
    <div className="episodes-panel__body">
      <div className="episodes-panel__head">
        {seasonItems.length > 1 ? (
          <div className="episodes-panel__seasons" role="tablist" aria-label={t('item.seasons')}>
            {seasonItems.map((season) => (
              <button
                key={season.id}
                type="button"
                role="tab"
                className="player-menu__tab"
                aria-selected={season.id === shownSeasonId}
                onClick={() => setChosenSeasonId(season.id)}
              >
                {seasonLabel(season)}
              </button>
            ))}
          </div>
        ) : (
          <h2 className="episodes-panel__title">
            {seasonItems[0] === undefined ? t('item.episodes') : seasonLabel(seasonItems[0])}
          </h2>
        )}
        <button
          type="button"
          className="player__control player__control--small"
          aria-label={t('common.close')}
          onClick={onClose}
        >
          <CloseIcon size={18} />
        </button>
      </div>
      <ol className="episodes-panel__list">
        {episodes.isPending
          ? skeletonRows.map((row) => (
              <li
                key={row}
                className="episodes-panel__row episodes-panel__row--skeleton"
                aria-hidden="true"
              >
                <span className="episodes-panel__still skeleton" />
                <span className="episodes-panel__text">
                  <span className="skeleton episodes-panel__line" />
                  <span className="skeleton episodes-panel__line episodes-panel__line--short" />
                </span>
              </li>
            ))
          : episodeCards(episodeItems).map((episode) => {
              const ratio = progressRatioOf(episode)
              const durationMs = durationMsOf(episode)
              const current = playing !== undefined && holds(episode, playing)
              const number = listedNumber(episode, episodeNumberLabel(episode))
              return (
                <li key={episode.id}>
                  <button
                    type="button"
                    className="episodes-panel__row"
                    aria-current={current ? 'true' : undefined}
                    onClick={() => (current ? onClose() : onPlay(episode))}
                  >
                    <span className={`episodes-panel__still tone-${toneOf(episode.id)}`}>
                      <Artwork src={episode.images.still ?? fallbackArt} className="cover-img" />
                      {ratio === undefined ? undefined : (
                        <progress
                          className="episodes-panel__bar"
                          value={ratio}
                          max={1}
                          aria-hidden="true"
                        />
                      )}
                    </span>
                    <span className="episodes-panel__text">
                      <span className="episodes-panel__name">
                        {number === undefined ? '' : `${number}. `}
                        {itemTitle(t, episode)}
                      </span>
                      {durationMs === undefined ? undefined : (
                        <span className="episodes-panel__duration">
                          {formatDuration(durationMs, locale)}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              )
            })}
      </ol>
    </div>
  )
}
