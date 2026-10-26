import { useQuery } from '@tanstack/react-query'
import { type FormEvent, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { PlaybackSettingsDto } from '@projo/shared/api/settings'

import { Field, Switch } from '../../../shared/ui/controls.tsx'
import { ErrorAlert, ErrorState } from '../../../shared/ui/states.tsx'
import { settingsQuery, useUpdateSettings } from './queries.ts'
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

/** A switch saved at once. */
const ToggleSetting = ({
  playback,
  setting,
}: {
  playback: PlaybackSettingsDto
  setting: Toggle
}) => {
  const { t } = useTranslation()
  const id = useId()
  const update = useUpdateSettings()
  return (
    <>
      <div className="setting">
        <span id={id} className="setting__label">
          {t(toggleLabels[setting])}
        </span>
        <Switch
          checked={isOn(playback, setting)}
          labelId={id}
          onChange={(on) => {
            if (!update.isPending) update.mutate({ playback: bodyOf(setting, on) })
          }}
        />
      </div>
      {update.isError ? <ErrorAlert error={update.error} /> : undefined}
    </>
  )
}

const limits = {
  maxConcurrentTranscodes: { min: 1, max: 16 },
  transcodeCacheMaxGb: { min: 1, max: 10_000 },
} as const

type Limit = keyof typeof limits

const limitLabels = {
  maxConcurrentTranscodes: 'admin.playbackSettings.maxTranscodes',
  transcodeCacheMaxGb: 'admin.playbackSettings.cacheSize',
} as const

const parseLimit = (key: Limit, value: string): number | undefined => {
  const number = Number(value)
  const { min, max } = limits[key]
  return value.trim() !== '' && Number.isInteger(number) && number >= min && number <= max
    ? number
    : undefined
}

/** The two limits, saved together with "Enregistrer". */
const Limits = ({ playback }: { playback: PlaybackSettingsDto }) => {
  const { t } = useTranslation()
  const id = useId()
  const update = useUpdateSettings()
  const [draft, setDraft] = useState<Record<Limit, string>>({
    maxConcurrentTranscodes: String(playback.maxConcurrentTranscodes),
    transcodeCacheMaxGb: String(playback.transcodeCacheMaxGb),
  })
  const parsed = {
    maxConcurrentTranscodes: parseLimit('maxConcurrentTranscodes', draft.maxConcurrentTranscodes),
    transcodeCacheMaxGb: parseLimit('transcodeCacheMaxGb', draft.transcodeCacheMaxGb),
  }
  const valid =
    parsed.maxConcurrentTranscodes !== undefined && parsed.transcodeCacheMaxGb !== undefined
  const changes: Partial<PlaybackSettingsDto> = {
    ...(parsed.maxConcurrentTranscodes === undefined ||
    parsed.maxConcurrentTranscodes === playback.maxConcurrentTranscodes
      ? {}
      : { maxConcurrentTranscodes: parsed.maxConcurrentTranscodes }),
    ...(parsed.transcodeCacheMaxGb === undefined ||
    parsed.transcodeCacheMaxGb === playback.transcodeCacheMaxGb
      ? {}
      : { transcodeCacheMaxGb: parsed.transcodeCacheMaxGb }),
  }
  const dirty = valid && Object.keys(changes).length > 0

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (dirty && !update.isPending) update.mutate({ playback: changes })
  }

  return (
    <div className="settings-block">
      <form className="seg-thresholds playback-limits" onSubmit={submit} noValidate>
        {(Object.keys(limits) as Limit[]).map((key) => {
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

/**
 * `/admin/settings/playback` (§15 "Playback"): simultaneous transcodes, transcode cache size,
 * stereo downmix, burnt-in subtitles, timeline thumbnails, hardware transcoding. Applied to the next session or job,
 * without restart (§10).
 */
export const PlaybackSettingsPage = () => {
  const { t } = useTranslation()
  const settings = useQuery(settingsQuery)
  return (
    <div className="admin-page">
      <div className="admin-page__header">
        <h1 className="admin-page__title">{t('admin.playbackSettings.title')}</h1>
      </div>
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
                key={`${settings.data.playback.maxConcurrentTranscodes}-${settings.data.playback.transcodeCacheMaxGb}`}
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
