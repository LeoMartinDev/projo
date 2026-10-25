import { useQuery } from '@tanstack/react-query'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Field, SelectChevron } from '../../../shared/ui/controls.tsx'
import { CheckIcon, LayersIcon, SyncIcon } from '../../../shared/ui/icons.tsx'
import { ErrorAlert } from '../../../shared/ui/states.tsx'
import { librariesQuery } from '../queries.ts'
import { useRefreshLibrary } from './queries.ts'
import './editing.css'

/** How long "Refresh started" stays before the button can be used again. */
const queuedMs = 4000

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
  const { isSuccess, reset } = refresh
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
        disabled={libraryId === undefined || refresh.isPending || refresh.isSuccess}
        {...(name === undefined
          ? {}
          : { 'aria-label': t('admin.metadataRefresh.actionOf', { name }) })}
        onClick={() => {
          if (libraryId !== undefined) refresh.mutate(libraryId)
        }}
      >
        {refresh.isPending ? (
          <span className="spinner" aria-hidden="true" />
        ) : refresh.isSuccess ? (
          <CheckIcon size={16} />
        ) : (
          <SyncIcon />
        )}
        {refresh.isSuccess ? t('admin.metadataRefresh.queued') : t('admin.metadataRefresh.action')}
      </button>
      {refresh.isError ? <ErrorAlert error={refresh.error} /> : undefined}
    </>
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
