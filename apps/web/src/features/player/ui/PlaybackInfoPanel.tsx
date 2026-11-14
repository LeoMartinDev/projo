import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { type PlaybackInfoLive, watchPlaybackInfo } from '@projo/player/application/playback-info'
import type { PlayerEngine } from '@projo/player/core/engine'
import type { PlaybackSessionDto } from '@projo/shared/api/playback'

import { currentLocale } from '../../../shared/i18n/index.ts'
import { CloseIcon } from '../../../shared/ui/icons.tsx'
import { browserTimers, playbackApi } from '../playback-api.ts'
import { playbackInfoGroups } from './playback-info.ts'

/**
 * The playback info (§10.7): how the session plays (mode and why, the file, what the server
 * sends, what the engine decodes), refreshed every 2 s. Mounted per session (`key`).
 */
export const PlaybackInfoPanel = ({
  session,
  engine,
  audioIndex,
  subtitleId,
  bufferAheadS,
  onClose,
}: {
  session: PlaybackSessionDto
  engine: Pick<PlayerEngine, 'stats'>
  audioIndex: number | undefined
  subtitleId: string | undefined
  bufferAheadS: number | undefined
  onClose: () => void
}) => {
  const { t } = useTranslation()
  const [live, setLive] = useState<PlaybackInfoLive | undefined>(undefined)
  useEffect(
    () =>
      watchPlaybackInfo({
        session,
        engine,
        api: playbackApi,
        timers: browserTimers,
        onChange: setLive,
      }),
    [session, engine],
  )
  // Shown once the first read is in: it does not grow under the eye.
  if (live === undefined) return undefined
  const groups = playbackInfoGroups({
    t,
    locale: currentLocale(),
    session,
    live,
    audioIndex,
    subtitleId,
    bufferAheadS,
  })
  return (
    <section className="playback-info" aria-label={t('player.info.title')}>
      <button
        type="button"
        className="playback-info__close"
        aria-label={t('common.close')}
        onClick={onClose}
      >
        <CloseIcon size={14} />
      </button>
      {groups.map((group) => (
        <div key={group.title} className="playback-info__group">
          <h2 className="playback-info__title">{group.title}</h2>
          <dl className="playback-info__rows">
            {group.rows.map((row) => (
              <div key={row.label} className="playback-info__row">
                <dt>{row.label}</dt>
                <dd className={row.warn === true ? 'playback-info__warn' : undefined}>
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
    </section>
  )
}
