import { useQuery } from '@tanstack/react-query'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Field, SelectChevron } from '../../../shared/ui/controls.tsx'
import { CheckIcon, LayersIcon, SyncIcon } from '../../../shared/ui/icons.tsx'
import { ErrorAlert } from '../../../shared/ui/states.tsx'
import { librariesQuery } from '../queries.ts'
import { useOptimizeImages, useRefreshLibrary } from './queries.ts'
import './editing.css'

/** How long "Refresh started" stays before the button can be used again. */
const queuedMs = 4000

/** A button that queues a job: a spinner while asked, then "queued" for a few seconds. */
const QueueJobButton = ({
  job,
  label,
  queuedLabel,
  ariaLabel,
  className,
  disabled = false,
  onClick,
}: {
  job: { isPending: boolean; isSuccess: boolean; error: unknown; reset: () => void }
  label: string
  queuedLabel: string
  ariaLabel?: string
  className: string
  disabled?: boolean
  onClick: () => void
}) => {
  const { isSuccess, reset } = job
  useEffect(() => {
    if (!isSuccess) return
    const timer = setTimeout(reset, queuedMs)
    return () => clearTimeout(timer)
  }, [isSuccess, reset])
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={disabled || job.isPending || isSuccess}
        {...(ariaLabel === undefined ? {} : { 'aria-label': ariaLabel })}
        onClick={onClick}
      >
        {job.isPending ? (
          <span className="spinner" aria-hidden="true" />
        ) : isSuccess ? (
          <CheckIcon size={16} />
        ) : (
          <SyncIcon />
        )}
        {isSuccess ? queuedLabel : label}
      </button>
      {job.error ? <ErrorAlert error={job.error} /> : undefined}
    </>
  )
}

/**
 * "Refresh the whole library" (§9.4, §15): one low-priority job per identified movie or
 * series, locks respected. The jobs show in "Jobs"; the catalog follows `catalog.changed`.
 */
export const RefreshLibraryButton = ({
  libraryId,
  name,
  className = 'button button--glass button--small',
}: {
  libraryId: string | undefined
  name?: string
  className?: string
}) => {
  const { t } = useTranslation()
  const refresh = useRefreshLibrary()
  return (
    <QueueJobButton
      job={refresh}
      label={t('admin.metadataRefresh.action')}
      queuedLabel={t('admin.metadataRefresh.queued')}
      {...(name === undefined ? {} : { ariaLabel: t('admin.metadataRefresh.actionOf', { name }) })}
      className={className}
      disabled={libraryId === undefined}
      onClick={() => {
        if (libraryId !== undefined) refresh.mutate(libraryId)
      }}
    />
  )
}

/**
 * "Optimize the images" (§9.1): the WebP variants of the images stored without them (before
 * they existed). Followed in "Jobs".
 */
export const OptimizeImagesSetting = () => {
  const { t } = useTranslation()
  const optimize = useOptimizeImages()
  return (
    <div className="settings-block refresh-library">
      <QueueJobButton
        job={optimize}
        label={t('admin.imageOptimize.action')}
        queuedLabel={t('admin.imageOptimize.queued')}
        className="button button--glass"
        onClick={() => optimize.mutate()}
      />
    </div>
  )
}

/** Section of the "Metadata" page: a library, then the button. */
export const RefreshLibrarySetting = () => {
  const { t } = useTranslation()
  const id = useId()
  const libraries = useQuery(librariesQuery)
  const [chosen, setChosen] = useState<string | undefined>(undefined)
  const items = libraries.data?.items ?? []
  const libraryId = chosen ?? items[0]?.id
  return (
    <div className="settings-block refresh-library">
      <Field
        id={id}
        label={t('admin.metadataRefresh.title')}
        icon={<LayersIcon />}
        trail={<SelectChevron />}
      >
        <select
          id={id}
          className="field__input"
          value={libraryId ?? ''}
          disabled={items.length === 0}
          onChange={(event) => setChosen(event.target.value)}
        >
          {items.map((library) => (
            <option key={library.id} value={library.id}>
              {library.name}
            </option>
          ))}
        </select>
      </Field>
      <RefreshLibraryButton
        key={libraryId}
        libraryId={libraryId}
        className="button button--glass"
      />
    </div>
  )
}
