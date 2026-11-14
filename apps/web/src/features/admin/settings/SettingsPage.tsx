import { useQuery } from '@tanstack/react-query'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { currentLocale } from '../../../shared/i18n/index.ts'
import { ValidMark } from '../../../shared/ui/controls.tsx'
import { SelectField } from '../../../shared/ui/Select.tsx'
import { ErrorAlert, ErrorState } from '../../../shared/ui/states.tsx'
import { GlobeIcon } from '../admin-icons.tsx'
import { languageLabel, metadataLanguages } from '../languages.ts'
import { RefreshLibrarySetting } from '../metadata/RefreshLibrary.tsx'
import { ApiKeySetting } from './ApiKeySetting.tsx'
import { settingsQuery, tmdbKeyPageUrl, useUpdateSettings } from './queries.ts'
import { SegmentSettings } from './SegmentSettings.tsx'
import { AdminPageHeader } from '../AdminPageHeader.tsx'
import '../admin.css'
import './settings.css'

const MetadataLanguage = ({ language }: { language: string }) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const id = useId()
  const update = useUpdateSettings()
  const known = metadataLanguages.some((code) => code === language)
  return (
    <div className="settings-block">
      <SelectField<string>
        id={`${id}-language`}
        label={t('admin.settings.language')}
        icon={<GlobeIcon />}
        trail={
          <>
            {update.isSuccess ? <ValidMark label={t('admin.settings.saved')} /> : undefined}
            {update.isPending ? (
              <span className="spinner settings-spinner" aria-hidden="true" />
            ) : undefined}
          </>
        }
        value={language}
        disabled={update.isPending}
        options={(known ? metadataLanguages : [language, ...metadataLanguages]).map((code) => ({
          value: code,
          label: languageLabel(code, locale),
        }))}
        onChange={(next) => update.mutate({ metadata: { language: next } })}
      />
      {update.isError ? <ErrorAlert error={update.error} /> : undefined}
    </div>
  )
}

const SettingsSkeleton = () => (
  <>
    <span className="skeleton settings-skeleton" aria-hidden="true" />
    <span className="skeleton settings-skeleton" aria-hidden="true" />
  </>
)

export const MetadataSettingsPage = () => {
  const { t } = useTranslation()
  const settings = useQuery(settingsQuery)
  return (
    <div className="admin-page">
      <AdminPageHeader title={t('admin.settings.metadata')} />
      {settings.isError ? (
        <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
      ) : (
        <section className="settings-section" aria-label={t('admin.settings.metadata')}>
          {settings.isPending ? (
            <SettingsSkeleton />
          ) : (
            <>
              <ApiKeySetting
                label={t('admin.settings.tmdbKey')}
                status={{
                  configured: settings.data.metadata.tmdbApiKey.configured,
                  rejected: settings.data.metadata.tmdbApiKey.state === 'rejected',
                  ...(settings.data.metadata.tmdbApiKey.last4 === undefined
                    ? {}
                    : { last4: settings.data.metadata.tmdbApiKey.last4 }),
                }}
                minLength={16}
                toBody={(tmdbApiKey) => ({ metadata: { tmdbApiKey } })}
                removeTitle={t('admin.settings.removeTitle')}
                removeText={t('admin.settings.removeText')}
                link={{ href: tmdbKeyPageUrl, label: t('admin.settings.createKey') }}
              />
              <MetadataLanguage language={settings.data.metadata.language} />
              <RefreshLibrarySetting />
            </>
          )}
        </section>
      )}
    </div>
  )
}

export const SegmentsSettingsPage = () => {
  const { t } = useTranslation()
  const settings = useQuery(settingsQuery)
  return (
    <div className="admin-page">
      <AdminPageHeader title={t('admin.settings.segments.title')} />
      {settings.isError ? (
        <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
      ) : (
        <section className="settings-section" aria-label={t('admin.settings.segments.title')}>
          {settings.isPending ? (
            <SettingsSkeleton />
          ) : (
            <SegmentSettings segments={settings.data.segments} />
          )}
        </section>
      )}
    </div>
  )
}
