import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useEffect, useEffectEvent } from 'react'
import { useTranslation } from 'react-i18next'

import type { BackdropImage } from '../../shared/backdrops/Backdrop.tsx'
import { ArrowRightIcon, CheckIcon } from '../../shared/ui/icons.tsx'
import {
  AnalysisCount,
  AnalysisDetail,
  AnalysisMeter,
  hasAnalysisInProgress,
  libraryState,
  LibraryStatus,
} from '../admin/library-status.tsx'
import { useLiveScans } from '../admin/live-scans.ts'
import { libraryQuery } from '../admin/queries.ts'
import { Logo } from '../shell/Logo.tsx'
import type { CreatedLibrary } from './LibraryStep.tsx'
import '../../shared/backdrops/backdrops.css'
import './setup.css'

const wallImages: readonly BackdropImage[] = [
  'ocean',
  'lighthouse',
  'dunes',
  'mountains',
  'city',
  'forest',
]

/** Seven drifting columns of four tiles, each column doubled so the loop is seamless. */
const wallColumns = Array.from({ length: 7 }, (_, column) => {
  const tiles = [0, 1, 2, 3].map(
    (row) => wallImages[(column * 5 + row * 3) % wallImages.length] ?? 'ocean',
  )
  return [...tiles, ...tiles]
})

const Wall = () => (
  <div className="wall" aria-hidden="true">
    <div className="wall__grid">
      {wallColumns.map((tiles, column) => (
        <div key={column} className="wall__column">
          {tiles.map((image, row) => (
            <div key={row} className={`wall__tile backdrop__image--${image}`} />
          ))}
        </div>
      ))}
    </div>
  </div>
)

/**
 * The first analysis, live: the walk, then the files on their way to `ready` (quiet period,
 * verification) until none is left, unreadable files counted apart.
 */
const FirstScan = ({ library }: { library: CreatedLibrary }) => {
  const { t } = useTranslation()
  const details = useQuery(libraryQuery(library.id))
  const { scans, markQueued } = useLiveScans({
    analyzing: details.data !== undefined && hasAnalysisInProgress(details.data),
  })

  // Creating the library queued its first scan: show it as started until the stream catches up.
  const showQueued = useEffectEvent(() => markQueued(library.id, library.requestedAt))
  useEffect(() => showQueued(), [library.id])

  if (details.data === undefined) return undefined
  const state = libraryState(details.data, scans.get(library.id))
  if (state.kind !== 'analyzing' && state.kind !== 'ok')
    return (
      <section className="panel ready__panel rise r4" aria-label={t('setup.ready.scan')}>
        <LibraryStatus state={state} />
      </section>
    )

  const label = t('setup.ready.scan')
  return (
    <section className="panel ready__panel rise r4" aria-label={label}>
      <div className="ready__task-head">
        <span className="ready__task">
          {state.kind === 'ok' ? <CheckIcon size={16} stroke={2.4} /> : undefined}
          {label}
        </span>
        <span className="ready__status" role="status">
          {state.kind === 'ok' ? t('setup.ready.done') : <AnalysisCount state={state} />}
        </span>
      </div>
      {state.kind === 'ok' ? (
        <span className="lib-status__progress ready__meter">
          <progress className="bar" value={100} max={100} aria-label={label} />
        </span>
      ) : (
        <AnalysisMeter state={state} label={label} withCount={false} className="ready__meter" />
      )}
      <AnalysisDetail state={state} />
    </section>
  )
}

/** Artboard `OnbReady`: the server is set up; the first scan carries on in the background. */
export const ReadyScreen = ({ name, library }: { name: string; library?: CreatedLibrary }) => {
  const { t } = useTranslation()
  return (
    <div className="onb onb--ready">
      <Wall />
      <header className="onb__header">
        <Logo />
      </header>
      <main className="onb__main onb__main--center">
        <span className="ready__mark" aria-hidden="true">
          <CheckIcon size={32} stroke={2.6} />
        </span>
        <h1 className="onb__hero onb__hero--center rise r2">{t('setup.ready.title', { name })}</h1>
        {library === undefined ? undefined : <FirstScan library={library} />}
        <div className="ready__actions rise r5">
          <Link to="/" className="button button--primary button--large">
            {t('setup.ready.open')}
            <span className="button__arrow" aria-hidden="true">
              <ArrowRightIcon />
            </span>
          </Link>
          <Link to="/admin/libraries" className="button button--glass button--large">
            {t('setup.ready.admin')}
          </Link>
        </div>
      </main>
    </div>
  )
}
