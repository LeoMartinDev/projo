import { useQuery } from '@tanstack/react-query'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import type { AdminSettingsDto } from '@projo/shared/api/settings'
import { ok } from '@projo/shared/result'

import { currentLocale } from '../../../shared/i18n/index.ts'
import { SelectField } from '../../../shared/ui/Select.tsx'
import { ErrorState } from '../../../shared/ui/states.tsx'
import { GlobeIcon } from '../admin-icons.tsx'
import { SettingsSection } from '../admin-sections.tsx'
import { languageLabel, metadataLanguages } from '../languages.ts'
import { ApiKeySetting } from './ApiKeySetting.tsx'
import { settingsQuery, tmdbKeyPageUrl } from './queries.ts'
import { SaveBar } from './SaveBar.tsx'
import { SegmentSettings } from './SegmentSettings.tsx'
import { SettingsSkeleton } from './SettingsSkeleton.tsx'
import { useSettingsForm } from './use-settings-form.ts'
import '../admin.css'
import './settings.css'

type MetadataDraft = { language: string }

const languageChanges = (draft: MetadataDraft, changed: Partial<MetadataDraft>) =>
  ok(changed.language === undefined ? {} : { metadata: { language: draft.language } })

const MetadataSettings = ({ metadata }: { metadata: AdminSettingsDto['metadata'] }) => {
  const { t } = useTranslation()
  const locale = currentLocale()
  const id = useId()
  const form = useSettingsForm<MetadataDraft, never>({
    saved: { language: metadata.language },
    changes: languageChanges,
  })
  const language = form.draft.language
  const known = metadataLanguages.some((code) => code === language)
  return (
    <>
      <section className="settings-section" aria-label={t('admin.tabs.metadata')}>
        <div className="settings-block">
          <SelectField<string>
            id={`${id}-language`}
            label={t('admin.settings.language')}
            icon={<GlobeIcon />}
            value={language}
            options={(known ? metadataLanguages : [language, ...metadataLanguages]).map((code) => ({
              value: code,
              label: languageLabel(code, locale),
            }))}
            onChange={(next) => form.set('language', next)}
          />
        </div>
        <ApiKeySetting
          label={t('admin.settings.tmdbKey')}
          status={{
            configured: metadata.tmdbApiKey.configured,
            rejected: metadata.tmdbApiKey.state === 'rejected',
            ...(metadata.tmdbApiKey.last4 === undefined
              ? {}
              : { last4: metadata.tmdbApiKey.last4 }),
          }}
          minLength={16}
          toBody={(tmdbApiKey) => ({ metadata: { tmdbApiKey } })}
          removeTitle={t('admin.settings.removeTitle')}
          removeText={t('admin.settings.removeText')}
          link={{ href: tmdbKeyPageUrl, label: t('admin.settings.createKey') }}
        />
      </section>
      <SaveBar form={form} />
    </>
  )
}

/** Settings › Metadata (§15): the language, the TMDB key (replaced at once by its "Validate"). */
export const MetadataSettingsPage = () => {
  const settings = useQuery(settingsQuery)
  return (
    <SettingsSection>
      {settings.isError ? (
        <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
      ) : settings.data === undefined ? (
        <SettingsSkeleton />
      ) : (
        <MetadataSettings metadata={settings.data.metadata} />
      )}
    </SettingsSection>
  )
}

/** Settings › Intros and credits (§15). */
export const SegmentsSettingsPage = () => {
  const settings = useQuery(settingsQuery)
  return (
    <SettingsSection>
      {settings.isError ? (
        <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
      ) : settings.data === undefined ? (
        <SettingsSkeleton />
      ) : (
        <SegmentSettings segments={settings.data.segments} />
      )}
    </SettingsSection>
  )
}
