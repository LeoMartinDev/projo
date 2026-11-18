import { useQuery } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { PlaybackSettingsDto } from '@projo/shared/api/settings'

import { Field } from '../../../shared/ui/controls.tsx'
import { ErrorAlert, ErrorState } from '../../../shared/ui/states.tsx'
import { SwitchSetting } from '../../../shared/ui/Setting.tsx'
import { settingsQuery, useUpdateSettings } from './queries.ts'
import { AdminPageHeader } from '../AdminPageHeader.tsx'
import '../admin.css'
import './settings.css'

type Toggle = 'audioDownmix' | 'burnInEnabled' | 'trickplayEnabled' | 'hwAccel'

const toggleLabels = {
  audioDownmix: 'admin.playbackSettings.downmix',
  burnInEnabled: 'admin.playbackSettings.burnIn',
  trickplayEnabled: 'admin.playbackSettings.trickplay',
  hwAccel: 'admin.playbackSettings.hwAccel',
} as const

const isOn = (playback: PlaybackSettingsDto, key: Toggle): boolean =>
  key === 'audioDownmix'
    ? playback.audioDownmix === 'stereo'
    : key === 'hwAccel'
      ? playback.hwAccel === 'vaapi'
      : playback[key]

const bodyOf = (key: Toggle, on: boolean): Partial<PlaybackSettingsDto> =>
  key === 'audioDownmix'
    ? { audioDownmix: on ? 'stereo' : 'keep' }
    : key === 'hwAccel'
      ? { hwAccel: on ? 'vaapi' : 'off' }
      : { [key]: on }

const ToggleSetting = ({
  playback,
  setting,
}: {
  playback: PlaybackSettingsDto
  setting: Toggle
}) => {
  const { t } = useTranslation()
  const update = useUpdateSettings()
  return (
    <>
      <SwitchSetting
        label={t(toggleLabels[setting])}
        checked={isOn(playback, setting)}
        onChange={(on) => {
          if (!update.isPending) update.mutate({ playback: bodyOf(setting, on) })
        }}
      />
      {update.isError ? <ErrorAlert error={update.error} /> : undefined}
    </>
  )
}

// The numbers of the Playback section, live TV's included (§29.4).
const limits = {
  maxConcurrentTranscodes: { min: 1, max: 16 },
  transcodeCacheMaxGb: { min: 1, max: 10_000 },
  liveWindowMinutes: { min: 1, max: 240 },
  liveCacheMaxGb: { min: 1, max: 10_000 },
} as const

type Limit = keyof typeof limits

const limitKeys = Object.keys(limits) as Limit[]

const limitLabels = {
  maxConcurrentTranscodes: 'admin.playbackSettings.maxTranscodes',
  transcodeCacheMaxGb: 'admin.playbackSettings.cacheSize',
  liveWindowMinutes: 'admin.playbackSettings.liveWindow',
  liveCacheMaxGb: 'admin.playbackSettings.liveCacheSize',
} as const

const parseLimit = (key: Limit, value: string): number | undefined => {
  const number = Number(value)
  const { min, max } = limits[key]
  return value.trim() !== '' && Number.isInteger(number) && number >= min && number <= max
    ? number
    : undefined
}

const Limits = ({ playback }: { playback: PlaybackSettingsDto }) => {
  const { t } = useTranslation()
  const id = useId()
  const update = useUpdateSettings()
  const [draft, setDraft] = useState<Record<Limit, string>>(
    () =>
      Object.fromEntries(limitKeys.map((key) => [key, String(playback[key])])) as Record<
        Limit,
        string
      >,
  )
  const parsed = Object.fromEntries(
    limitKeys.map((key) => [key, parseLimit(key, draft[key])]),
  ) as Record<Limit, number | undefined>
  const valid = limitKeys.every((key) => parsed[key] !== undefined)
  const changes: Partial<PlaybackSettingsDto> = Object.fromEntries(
    limitKeys.flatMap((key) => {
      const value = parsed[key]
      return value === undefined || value === playback[key] ? [] : [[key, value]]
    }),
  )
  const dirty = valid && Object.keys(changes).length > 0

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (dirty && !update.isPending) update.mutate({ playback: changes })
  }

  return (
    <div className="settings-block">
      <form className="seg-thresholds playback-limits" onSubmit={submit} noValidate>
        {limitKeys.map((key) => {
          const invalid = parsed[key] === undefined
          return (
            <Field key={key} id={`${id}-${key}`} label={t(limitLabels[key])} invalid={invalid}>
              <input
                id={`${id}-${key}`}
                className="field__input"
                type="number"
                inputMode="numeric"
                min={limits[key].min}
                max={limits[key].max}
                step={1}
                value={draft[key]}
                aria-invalid={invalid}
                onChange={(event) => {
                  setDraft({ ...draft, [key]: event.target.value })
                  if (update.isError || update.isSuccess) update.reset()
                }}
              />
            </Field>
          )
        })}
        <div className="seg-thresholds__actions">
          <button
            type="submit"
            className="button button--primary"
            disabled={!dirty || update.isPending}
          >
            {update.isPending ? <span className="spinner" aria-hidden="true" /> : undefined}
            {t('common.save')}
          </button>
        </div>
      </form>
      {update.isError ? <ErrorAlert error={update.error} /> : undefined}
    </div>
  )
}

export const PlaybackSettingsPage = () => {
  const { t } = useTranslation()
  const settings = useQuery(settingsQuery)
  return (
    <div className="admin-page">
      <AdminPageHeader title={t('admin.playbackSettings.title')} />
      {settings.isError ? (
        <ErrorState error={settings.error} onRetry={() => void settings.refetch()} />
      ) : (
        <section className="settings-section" aria-label={t('admin.playbackSettings.title')}>
          {settings.isPending ? (
            <>
              <span className="skeleton settings-skeleton" aria-hidden="true" />
              <span className="skeleton settings-skeleton" aria-hidden="true" />
            </>
          ) : (
            <>
              <Limits
                key={limitKeys.map((key) => settings.data.playback[key]).join('-')}
                playback={settings.data.playback}
              />
              <div className="settings-block settings-block--switches">
                {(['audioDownmix', 'burnInEnabled', 'trickplayEnabled', 'hwAccel'] as const).map(
                  (key) => (
                    <ToggleSetting key={key} playback={settings.data.playback} setting={key} />
                  ),
                )}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  )
}
