import { useQuery } from '@tanstack/react-query'
import { type FormEvent, useId } from 'react'
import { useTranslation } from 'react-i18next'

import type { PlaybackSettingsDto } from '@projo/shared/api/settings'

import { Field } from '../../../shared/ui/controls.tsx'
import { ErrorState } from '../../../shared/ui/states.tsx'
import { SwitchSetting } from '../../../shared/ui/Setting.tsx'
import { SettingsSection } from '../admin-sections.tsx'
import {
  playbackChanges,
  playbackDraftOf,
  playbackLimitKeys,
  playbackLimits,
  playbackToggleKeys,
} from './playback-form.ts'
import { settingsQuery } from './queries.ts'
import { SaveBar } from './SaveBar.tsx'
import { SettingsSkeleton } from './SettingsSkeleton.tsx'
import { useSettingsForm } from './use-settings-form.ts'
import '../admin.css'
import './settings.css'

const toggleLabels = {
  audioDownmix: 'admin.playbackSettings.downmix',
  burnInEnabled: 'admin.playbackSettings.burnIn',
  trickplayEnabled: 'admin.playbackSettings.trickplay',
  hwAccel: 'admin.playbackSettings.hwAccel',
} as const

const limitLabels = {
  maxConcurrentTranscodes: 'admin.playbackSettings.maxTranscodes',
  transcodeCacheMaxGb: 'admin.playbackSettings.cacheSize',
  liveWindowMinutes: 'admin.playbackSettings.liveWindow',
  liveCacheMaxGb: 'admin.playbackSettings.liveCacheSize',
} as const

const PlaybackForm = ({ playback }: { playback: PlaybackSettingsDto }) => {
  const { t } = useTranslation()
  const id = useId()
  const form = useSettingsForm({ saved: playbackDraftOf(playback), changes: playbackChanges })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    form.save()
  }
  return (
    <>
      <section className="settings-section" aria-label={t('admin.tabs.playback')}>
        <form className="seg-thresholds playback-limits" onSubmit={submit} noValidate>
          {playbackLimitKeys.map((key) => {
            const invalid = form.invalid.includes(key)
            return (
              <Field key={key} id={`${id}-${key}`} label={t(limitLabels[key])} invalid={invalid}>
                <input
                  id={`${id}-${key}`}
                  className="field__input"
                  type="number"
                  inputMode="numeric"
                  min={playbackLimits[key].min}
                  max={playbackLimits[key].max}
                  step={1}
                  value={form.draft[key]}
                  aria-invalid={invalid}
                  onChange={(event) => form.set(key, event.target.value)}
                />
              </Field>
            )
          })}
        </form>
        <div className="settings-block settings-block--switches">
          {playbackToggleKeys.map((key) => (
            <SwitchSetting
              key={key}
              label={t(toggleLabels[key])}
              checked={form.draft[key]}
              onChange={(on) => form.set(key, on)}
            />
          ))}
        </div>
      </section>
      <SaveBar form={form} />
    </>
  )
}

/** Settings › Playback (§15): transcoding, subtitles, previews, live TV's replay. */
export const PlaybackSettingsPage = () => {
  const settings = useQuery(settingsQuery)
  return (
    <SettingsSection>
      {settings.isError ? (
        <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
      ) : settings.data === undefined ? (
        <SettingsSkeleton />
      ) : (
        <PlaybackForm playback={settings.data.playback} />
      )}
    </SettingsSection>
  )
}
